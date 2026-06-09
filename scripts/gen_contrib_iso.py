#!/usr/bin/env python3
import sys, os, json, urllib.request, random

def fetch(login, token):
    q = """query($login:String!){user(login:$login){contributionsCollection{contributionCalendar{totalContributions weeks{contributionDays{contributionCount contributionLevel}}}}}}"""
    data = json.dumps({"query": q, "variables": {"login": login}}).encode()
    req = urllib.request.Request("https://api.github.com/graphql", data=data,
        headers={"Authorization":"bearer "+token,"Content-Type":"application/json","User-Agent":login})
    with urllib.request.urlopen(req) as r:
        c = json.load(r)["data"]["user"]["contributionsCollection"]["contributionCalendar"]
    return c["weeks"], c["totalContributions"]

LEVEL={"NONE":0,"FIRST_QUARTILE":1,"SECOND_QUARTILE":2,"THIRD_QUARTILE":3,"FOURTH_QUARTILE":4}
TOP=["#16202c","#214a60","#2f7290","#5bb6d4","#a6ecff"]   # rampa hielo por nivel
def dk(h,f):
    h=h.lstrip("#");r,g,b=int(h[0:2],16),int(h[2:4],16),int(h[4:6],16)
    return "#%02x%02x%02x"%(int(r*f),int(g*f),int(b*f))

def build(weeks, total):
    TW,TH=11.0,5.5; MAXH=40.0
    counts=[d["contributionCount"] for w in weeks for d in w["contributionDays"]]
    mx=max(counts) or 1
    cells=[]
    for c,w in enumerate(weeks):
        for r,d in enumerate(w["contributionDays"]):
            lv=LEVEL.get(d["contributionLevel"],0); cnt=d["contributionCount"]
            h = 1.6 if cnt==0 else 4.0+((cnt/mx)**0.62)*MAXH    # curva: las chicas también presencian
            cells.append((c,r,lv,h))
    blocks=[]; glows=[]; xs=[]; ys=[]
    for c,r,lv,h in sorted(cells,key=lambda t:(t[0]+t[1],t[0])):
        gx=(c-r)*TW; gy=(c+r)*TH; topY=gy-h
        top=[(gx,topY-TH),(gx+TW,topY),(gx,topY+TH),(gx-TW,topY)]
        left=[(gx-TW,topY),(gx,topY+TH),(gx,topY+TH+h),(gx-TW,topY+h)]
        right=[(gx,topY+TH),(gx+TW,topY),(gx+TW,topY+h),(gx,topY+TH+h)]
        ct=TOP[lv]; pts=lambda f:" ".join(f"{x:.1f},{y:.1f}" for x,y in f)
        edge=0.0 if lv==0 else 0.25+lv*0.12   # rim-light más fuerte en torres altas
        blocks.append(
          f'<polygon points="{pts(left)}" fill="{dk(ct,0.5)}"/>'
          f'<polygon points="{pts(right)}" fill="{dk(ct,0.7)}"/>'
          f'<polygon points="{pts(top)}" fill="{ct}" stroke="#d6f3ff" stroke-width="0.5" stroke-opacity="{edge:.2f}"/>')
        if lv>=3:  # bloom en las torres con más actividad
            glows.append(f'<polygon points="{pts(top)}" fill="{TOP[4]}" opacity="0.5"/>')
        for f in (top,left,right):
            xs+=[x for x,_ in f]; ys+=[y for _,y in f]
    padX=40; padTop=70; padBot=40
    minx,maxx,miny,maxy=min(xs),max(xs),min(ys),max(ys)
    W=maxx-minx+2*padX; H=maxy-miny+padTop+padBot
    ox=padX-minx; oy=padTop-miny
    # nieve (ata con el hero)
    rnd=random.Random(7); flakes=[]
    for _ in range(22):
        fx=rnd.randint(0,int(W)); s=rnd.choice([2,2,3]); dur=round(rnd.uniform(9,17),1)
        beg=round(rnd.uniform(0,dur),1); op=round(rnd.uniform(0.35,0.8),2); sway=rnd.randint(6,16)
        flakes.append(f'<rect x="{fx}" y="-6" width="{s}" height="{s}" rx="0.5" fill="#dbeafe" opacity="{op}">'
          f'<animate attributeName="y" values="-6;{H:.0f}" dur="{dur}s" begin="-{beg}s" repeatCount="indefinite"/>'
          f'<animate attributeName="x" values="{fx};{fx+sway};{fx};{fx-sway};{fx}" dur="{round(dur*0.9,1)}s" begin="-{beg}s" repeatCount="indefinite"/></rect>')
    snow="\n    ".join(flakes)
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W:.0f} {H:.0f}" width="{W:.0f}" height="{H:.0f}" font-family="'Segoe UI',Verdana,sans-serif">
  <defs>
    <radialGradient id="bg" cx="50%" cy="42%" r="75%"><stop offset="0%" stop-color="#101826"/><stop offset="100%" stop-color="#0a0f18"/></radialGradient>
    <radialGradient id="vig" cx="50%" cy="46%" r="72%"><stop offset="64%" stop-color="#000" stop-opacity="0"/><stop offset="100%" stop-color="#000" stop-opacity="0.45"/></radialGradient>
    <filter id="bloom" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="6"/></filter>
  </defs>
  <rect width="{W:.0f}" height="{H:.0f}" fill="url(#bg)"/>
  <text x="{padX}" y="40" fill="#7fd1e8" font-size="15" font-weight="600" letter-spacing="4">CONTRIBUTIONS</text>
  <text x="{padX}" y="58" fill="#5b6b7d" font-size="12" letter-spacing="1">{total:,} en el último año</text>
  <g transform="translate({ox:.1f},{oy:.1f})">
    <g filter="url(#bloom)">
      {''.join(glows)}
    </g>
    {''.join(blocks)}
  </g>
  <g>
    {snow}
  </g>
  <rect width="{W:.0f}" height="{H:.0f}" fill="url(#vig)"/>
</svg>'''

if __name__=="__main__":
    login=sys.argv[1] if len(sys.argv)>1 else "nstefoni"
    token=os.environ.get("GITHUB_TOKEN") or os.environ.get("GH_TOKEN") or ""
    weeks,total=fetch(login,token); sys.stdout.write(build(weeks,total))
