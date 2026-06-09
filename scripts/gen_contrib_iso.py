#!/usr/bin/env python3
import sys, os, json, urllib.request

def fetch(login, token):
    q = """query($login:String!){user(login:$login){contributionsCollection{contributionCalendar{weeks{contributionDays{contributionCount contributionLevel}}}}}}"""
    data = json.dumps({"query": q, "variables": {"login": login}}).encode()
    req = urllib.request.Request("https://api.github.com/graphql", data=data,
        headers={"Authorization": "bearer "+token, "Content-Type": "application/json", "User-Agent": login})
    with urllib.request.urlopen(req) as r:
        return json.load(r)["data"]["user"]["contributionsCollection"]["contributionCalendar"]["weeks"]

LEVEL = {"NONE":0,"FIRST_QUARTILE":1,"SECOND_QUARTILE":2,"THIRD_QUARTILE":3,"FOURTH_QUARTILE":4}
# paleta hielo (cohesiva con el hero): top face por nivel
TOP = ["#16202c","#21465a","#2f6e87","#56a6c2","#a6ecff"]
def dk(h,f):
    h=h.lstrip("#"); r,g,b=int(h[0:2],16),int(h[2:4],16),int(h[4:6],16)
    return "#%02x%02x%02x"%(int(r*f),int(g*f),int(b*f))

def build(weeks):
    TW, TH = 11.0, 5.5          # medio-ancho / medio-alto del rombo
    MAXH = 34.0
    counts=[d["contributionCount"] for w in weeks for d in w["contributionDays"]]
    mx=max(counts) or 1
    cells=[]
    for c,w in enumerate(weeks):
        for r,d in enumerate(w["contributionDays"]):
            lv=LEVEL.get(d["contributionLevel"],0); cnt=d["contributionCount"]
            h = 2.0 if cnt==0 else 4.0 + (cnt/mx)*MAXH
            cells.append((c,r,lv,h))
    polys=[]; xs=[]; ys=[]
    for c,r,lv,h in sorted(cells, key=lambda t:(t[0]+t[1], t[0])):
        gx=(c-r)*TW; gy=(c+r)*TH; topY=gy-h
        top=[(gx,topY-TH),(gx+TW,topY),(gx,topY+TH),(gx-TW,topY)]
        left=[(gx-TW,topY),(gx,topY+TH),(gx,topY+TH+h),(gx-TW,topY+h)]
        right=[(gx,topY+TH),(gx+TW,topY),(gx+TW,topY+h),(gx,topY+TH+h)]
        ct=TOP[lv]
        for face,col in [(left,dk(ct,0.55)),(right,dk(ct,0.72)),(top,ct)]:
            pts=" ".join(f"{x:.1f},{y:.1f}" for x,y in face)
            polys.append(f'<polygon points="{pts}" fill="{col}"/>')
            xs+=[x for x,_ in face]; ys+=[y for _,y in face]
    pad=24
    minx,maxx,miny,maxy=min(xs),max(xs),min(ys),max(ys)
    W=maxx-minx+2*pad; H=maxy-miny+2*pad
    ox=pad-minx; oy=pad-miny
    body="\n".join(polys)
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W:.0f} {H:.0f}" width="{W:.0f}" height="{H:.0f}">
  <rect width="{W:.0f}" height="{H:.0f}" fill="#0d1117"/>
  <g transform="translate({ox:.1f},{oy:.1f})">
    {body}
  </g>
</svg>'''

if __name__=="__main__":
    login=sys.argv[1] if len(sys.argv)>1 else "nstefoni"
    token=os.environ.get("GITHUB_TOKEN") or os.environ.get("GH_TOKEN") or ""
    sys.stdout.write(build(fetch(login, token)))
