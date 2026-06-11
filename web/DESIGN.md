# design system — jitterscope dashboard

la regla madre: **el color es informacion, nunca decoracion**. tres familias de color con roles q no se pisan:

1. **identidad de canal** (convencion helicorder sismico): trazas MONOCROMAS en 4 tonos de tinta, del mas brillante (GH `#e9ede2`) al mas tenue (VRC al 38%). la identidad la da el carril + la etiqueta, no el color — como los sismografos reales. esto le devuelve al rojo todo su poder de alarma.
2. **semantica de estado**: lima = nominal · ambar `#ffc233` = advisory · rojo `#ff5449` = alert. SOLO para estados, nunca para identidad.
3. **neutros de chasis**: fondo `--bg #191c1e` · panel `--panel #101316` · chrome `rgba(20,23,26,.92)` · tinta `#e9ede2` · dim `#8b948f` · hairline `rgba(...,0.25)`.

## tokens (`:root` en index.html)

- espaciado: unidad `--u: 4px`, padding estandar `--pad: 12px`, gap de grilla 10px
- tipografia: mono stack siempre. escala `--fs-0..4`: 9/10/11/13/15px. tracking `--ls-1..3`: .18/.25/.35em. numeros con `tabular-nums` para q no bailen
- bordes: 1px hairline. sin radios (esquinas vivas = instrumento). el unico acento grueso: banner con borde izquierdo 3px del color del estado
- jerarquia de texto: titulo de panel = fs-0 + ls-2 + dim, uppercase. valor vivo = ink o color semantico. metadata = fs-0 dim

## componentes

- **panel**: borde hairline + fondo `--panel` + title bar con separador. boot: aparece con fade+rise (.55s) en cascada
- **boton (.cbtn)**: fantasma, borde hairline, texto dim. hover: borde+texto ink. activo de canal: borde+texto del color del canal. presionado: baja 1px. focus visible: outline acc
- **banner de alerta** (patron USGS PAGER): estado grande izquierda, metadata derecha, borde izquierdo 3px semantico
- **graficas**: canvas 2d para todo lo lineal (trazos 1.4px + pasada glow 3.2px al 16%), three.js SOLO para el waterfall (la unica grafica con 3 dimensiones de datos reales). dpr cap 2 en 2d, 1.5 en webgl

## reglas de oro

- nada de gradientes decorativos, sombras, ni radios — flat, vivo, denso
- un solo acento dominante (lima); ambar/rojo aparecen solo cuando la red lo amerita
- todo texto uppercase con tracking, sentence case prohibido en el chrome del dashboard
- si un color no codifica canal ni estado, es neutro
