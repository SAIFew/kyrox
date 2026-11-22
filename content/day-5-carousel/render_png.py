"""Rasterize the authored carousel at 2x for crisp, exact-size PNG exports.

The HTML/CSS files remain the editable publication source. This renderer mirrors
their fixed 1080x1350 artboards with Pillow so the exports do not depend on the
local Edge headless executable.
"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageFilter

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "slides"
OUT.mkdir(exist_ok=True)
S = 2
W, H = 1080, 1350
BG = (9, 13, 15)
PANEL = (16, 23, 21)
PANEL2 = (19, 28, 23)
LINE = (45, 59, 52)
GREEN = (162, 232, 188)
PALE = (238, 244, 239)
TEXT = (211, 222, 214)
MUTED = (139, 155, 145)
DIM = (103, 121, 110)
FONT_DIR = Path(r"C:\Windows\Fonts")
REG = FONT_DIR / "segoeui.ttf"
BOLD = FONT_DIR / "seguibl.ttf"
MONO = FONT_DIR / "consola.ttf"

def font(size, bold=False, mono=False):
    path = MONO if mono else (BOLD if bold else REG)
    return ImageFont.truetype(str(path), size * S)

def xy(box):
    return tuple(int(v * S) for v in box)

def make_slide(number):
    im = Image.new("RGB", (W * S, H * S), BG)
    pix = im.load()
    # Gentle green ambient light concentrated in the upper-right corner.
    for y in range(0, H * S, 6):
        for x in range(0, W * S, 6):
            d = ((x/S-910)**2/280**2 + (y/S-110)**2/260**2) ** .5
            strength = max(0, 1-d) * .12
            if strength:
                c = tuple(int(BG[i] * (1-strength) + (38, 74, 50)[i] * strength) for i in range(3))
                for yy in range(y, min(y+6, H*S)):
                    for xx in range(x, min(x+6, W*S)):
                        pix[xx, yy] = c
    d = ImageDraw.Draw(im)
    # Subtle technical grid.
    for x in range(32, W, 48):
        d.line(xy((x, 92, x, 1260)), fill=(17, 25, 25), width=1*S)
    for y in range(112, H, 48):
        d.line(xy((32, y, 1048, y)), fill=(17, 25, 25), width=1*S)
    # Masthead and footer.
    box(d, (72, 32, 102, 62), GREEN, LINE, 5)
    txt(d, (82, 33), "K", 18, (16, 34, 25), bold=True)
    txt(d, (114, 38), "K Y R O X", 14, PALE, bold=True)
    d.line(xy((214, 39, 214, 56)), fill=(58, 72, 65), width=1*S)
    txt(d, (230, 41), "AGENT DATA / 01", 9, MUTED, bold=True)
    txt(d, (849, 42), "FIELD NOTES   ·   MCP", 9, MUTED, bold=True)
    d.line(xy((0, 94, W, 94)), fill=(35, 46, 43), width=1*S)
    d.line(xy((0, 1285, W, 1285)), fill=(35, 46, 43), width=1*S)
    txt(d, (72, 1310), "KYROX / ENGINEERING SERIES", 8, DIM, bold=True)
    txt(d, (390, 1310), "LOCAL DEMO DATA · NOT LIVE MARKET DATA", 8, MUTED, bold=True)
    txt(d, (893, 1310), "DAY 05", 8, DIM, bold=True)
    txt(d, (973, 1304), "↗", 15, GREEN)
    # Section label.
    txt(d, (72, 143), ["DAY 05 / AGENT DATA ACCESS", "WHY STRUCTURE MATTERS", "MEET KYROX", "ONE REAL CALL PATH", "WHAT COMES NEXT"][number-1], 9, MUTED, bold=True)
    box(d, (58, 149, 65, 156), GREEN, radius=4)
    return im, d

def txt(d, pos, value, size=12, fill=TEXT, bold=False, mono=False, anchor=None):
    d.text((int(pos[0]*S), int(pos[1]*S)), value, font=font(size,bold,mono), fill=fill, anchor=anchor)

def box(d, coords, fill=PANEL, outline=LINE, radius=7, width=1):
    d.rounded_rectangle(xy(coords), radius=radius*S, fill=fill, outline=outline, width=width*S)

def line(d, coords, fill=LINE, width=1):
    d.line(xy(coords), fill=fill, width=width*S)

def circle(d, coords, fill, outline=None, width=1):
    d.ellipse(xy(coords), fill=fill, outline=outline, width=width*S)

def wrap(d, text, x, y, maxw, size, fill, bold=False, mono=False, leading=1.3):
    f=font(size,bold,mono); words=text.split(); rows=[]; cur=""
    for word in words:
        test=(cur+" "+word).strip()
        if d.textbbox((0,0),test,font=f)[2] <= maxw*S or not cur: cur=test
        else: rows.append(cur); cur=word
    if cur: rows.append(cur)
    for i,row in enumerate(rows): d.text((int(x*S),int((y+i*size*leading)*S)),row,font=f,fill=fill)
    return y+len(rows)*size*leading

def slide1():
    im,d=make_slide(1)
    txt(d,(72,225),"THE NEXT INTERFACE FOR FINANCIAL DATA",10,(151,178,160),True)
    lines=[("What if AI agents",PALE),("could retrieve",PALE),("stock market data",GREEN),("on their own?",PALE)]
    y=264
    for row,col in lines: txt(d,(72,y),row,48,col,True); y+=55
    wrap(d,"A question about access. A tool call is one practical starting point.",74,506,400,15,MUTED,leading=1.55)
    # Precision instrument panel.
    d.ellipse(xy((616,232,1032,648)),outline=(34,53,43),width=1*S)
    d.ellipse(xy((652,268,996,612)),outline=(40,63,48),width=1*S)
    box(d,(646,321,821,369),(17,25,22),(55,69,59),5)
    box(d,(660,333,681,354),GREEN,radius=4);txt(d,(666,333),"K",12,(17,36,24),True)
    txt(d,(695,339),"AI AGENT",9,TEXT,True)
    circle(d,(799,340,807,348),GREEN)
    line(d,(821,345,899,364),(112,164,124),1)
    box(d,(886,369,1032,439),(19,28,23),(58,84,64),6)
    txt(d,(901,380),"MCP TOOL",8,MUTED,True);txt(d,(901,397),"list_stocks",12,GREEN,False,True);txt(d,(901,419),"structured response",8,DIM)
    box(d,(680,475,1008,725),(18,26,22),(56,72,62),7)
    txt(d,(700,493),"●  LOCAL FIXTURE",8,GREEN,False,True);txt(d,(963,493),"01 / 03",8,DIM,False,True)
    txt(d,(701,538),"tAAPL",30,PALE,True,True);txt(d,(702,580),"Test Apple",11,MUTED)
    line(d,(700,613,988,613),(49,63,53))
    txt(d,(701,638),"reference_value",9,MUTED,False,True);txt(d,(949,632),"230.0",16,TEXT,False,True)
    txt(d,(701,680),"DEMO DATA · NOT A LIVE QUOTE",7,DIM,False,True)
    line(d,(844,725,844,864),(62,92,67),1)
    circle(d,(840,860,848,868),BG,(130,186,143),1)
    box(d,(72,887,1008,1082),(15,21,20),(40,52,47),7)
    txt(d,(100,926),"A TOOL MAKES DATA REACHABLE.",9,MUTED,True)
    txt(d,(100,968),"Agent request",18,PALE,True);txt(d,(352,968),"→",20,GREEN);txt(d,(402,968),"structured record",18,PALE,True)
    txt(d,(100,1012),"One clear path from a question to a machine-readable result.",11,MUTED)
    txt(d,(72,1206),"TOOLS MAKE DATA REACHABLE",9,MUTED,True);line(d,(268,1212,938,1212),(42,58,48));txt(d,(962,1206),"01 — 05",9,MUTED,True,True)
    return im

def slide2():
    im,d=make_slide(2)
    txt(d,(72,213),"FROM QUESTION TO USABLE INPUT",10,(151,178,160),True)
    txt(d,(72,254),"Agents need a reliable way",39,PALE,True)
    txt(d,(72,300),"to read beyond the chat.",39,GREEN,True)
    wrap(d,"External data becomes useful when the agent can request it and receive fields it can work with.",730,274,270,13,MUTED,leading=1.5)
    # Two contrasting panels.
    box(d,(72,390,498,850),(15,21,21),(44,54,56),7)
    box(d,(522,390,1008,850),(15,22,19),(57,77,61),7)
    line(d,(72,440,498,440),(45,54,54));line(d,(522,440,1008,440),(57,77,61))
    txt(d,(93,405),"01",9,DIM,False,True);txt(d,(126,405),"WITHOUT A DATA TOOL",8,MUTED,True);txt(d,(407,405),"UNCONNECTED",7,DIM,False,True)
    txt(d,(545,405),"02",9,GREEN,False,True);txt(d,(578,405),"WITH A STRUCTURED TOOL",8,MUTED,True);txt(d,(873,405),"JSON",7,GREEN,False,True)
    txt(d,(100,486),"“",40,(84,99,89));wrap(d,"Can you check the latest stocks for me?",104,535,350,22,TEXT,leading=1.35)
    for x in range(105,464,14): line(d,(x,679,x+5,679),(65,74,70))
    txt(d,(104,706),"No source attached to this request",9,DIM,False,True)
    circle(d,(487,595,495,603),GREEN)
    # JSON panel, true list_stocks fields and demo fixture names.
    box(d,(546,476,984,772),(10,16,14),(48,66,51),5)
    txt(d,(566,490),"●  list_stocks()",9,GREEN,False,True);txt(d,(925,490),"ARRAY",7,DIM,False,True)
    code=[("[",MUTED),("  {",MUTED),("    \"ticker\":",(151,209,164)),(" \"tAAPL\",",(212,196,144)),("    \"name\":",(151,209,164)),(" \"Test Apple\",",(212,196,144)),("    \"reference_value\":",(151,209,164)),(" 230.0",(167,218,177)),("  }",MUTED),( "]",MUTED)]
    y=533
    for s,c in code: txt(d,(565,y),s,10,c,False,True);y+=23
    # Connector between two states.
    txt(d,(495,600),"→",20,GREEN,False,False,"mm")
    # Footer principles.
    line(d,(72,923,1008,923),(43,55,52))
    for i,(title,desc) in enumerate([("Request","Call an available tool"),("Receive","Get predictable fields"),("Use","Reason over returned data")]):
        x=91+i*312
        txt(d,(x,966),f"0{i+1}",9,(133,177,143),False,True)
        txt(d,(x+40,957),title,14,PALE,True);txt(d,(x+40,984),desc,9,MUTED)
        if i<2: line(d,(x+282,952,x+282,1004),(44,58,50))
    box(d,(72,1060,1008,1141),(15,22,19),(43,59,48),5)
    txt(d,(96,1088),"STRUCTURE GIVES THE AGENT SOMETHING IT CAN PARSE",10,GREEN,True)
    txt(d,(72,1206),"STRUCTURED ACCESS FOR EXTERNAL DATA",9,MUTED,True);line(d,(337,1212,938,1212),(42,58,48));txt(d,(962,1206),"02 — 05",9,MUTED,True,True)
    return im

def slide3():
    im,d=make_slide(3)
    txt(d,(72,213),"A SMALL, EXPLICIT BRIDGE",10,(151,178,160),True)
    txt(d,(72,253),"KYROX is an",43,PALE,True);txt(d,(72,303),"MCP server for",43,GREEN,True);txt(d,(72,353),"structured stock records.",39,PALE,True)
    wrap(d,"It exposes Python functions as tools an MCP client can discover and call. Today, those tools read local demo fixtures.",707,272,300,13,MUTED,leading=1.55)
    # Main architecture rail.
    line(d,(121,650,958,650),(61,93,68),1)
    nodes=[(85,"MCP CLIENT","AI agent","requests a tool","AI"),(445,"FastMCP SERVER","KYROX","registers tool functions","K"),(805,"SOURCE TODAY","stocks.json","3 test records","{ }")]
    for idx,(x,over,title,sub,mark) in enumerate(nodes):
        box(d,(x,493,x+190,806),PANEL2,(82,111,84) if idx==1 else LINE,8,1)
        box(d,(x+74,526,x+116,568),(26,42,31),(82,111,84) if idx==1 else (91,112,98),8)
        txt(d,(x+95,547),mark,14,GREEN if idx==1 else TEXT,True,True,"mm")
        txt(d,(x+95,610),over,7,(150,185,158),True,True,"mm")
        txt(d,(x+95,646),title,14,PALE,True,False,"mm")
        txt(d,(x+95,675),sub,9,MUTED,False,False,"mm")
        if idx<2:
            txt(d,(x+231,642),"›",22,GREEN,False,False,"mm")
            txt(d,(x+277,596),"MCP / STDIO" if idx==0 else "LOCAL LOOKUP",7,DIM,True,True,"mm")
    # exposed tools line.
    txt(d,(72,890),"EXPOSED TOOLS",8,MUTED,True,True)
    box(d,(72,929,463,1000),(18,27,22),(53,73,57),4)
    circle(d,(92,960,98,966),GREEN);txt(d,(112,949),"list_stocks",11,PALE,True,True);txt(d,(112,978),"list summaries",8,MUTED)
    box(d,(483,929,885,1000),(18,27,22),(53,73,57),4)
    circle(d,(503,960,509,966),GREEN);txt(d,(523,949),"get_stock_info",11,PALE,True,True);txt(d,(523,978),"look up one ticker",8,MUTED)
    wrap(d,"Values are local fixtures, not live quotes.",72,1054,900,12,MUTED)
    txt(d,(72,1206),"AI CLIENT → MCP → LOCAL DATA",9,MUTED,True);line(d,(317,1212,938,1212),(42,58,48));txt(d,(962,1206),"03 — 05",9,MUTED,True,True)
    return im

def slide4():
    im,d=make_slide(4)
    txt(d,(72,209),"WHAT HAPPENS UNDER THE HOOD",10,(151,178,160),True)
    txt(d,(72,248),"One tool call.",38,PALE,True);txt(d,(72,292),"A structured result.",38,GREEN,True)
    wrap(d,"The server reads and validates the local JSON list, then returns stock summaries in source order.",686,269,320,13,MUTED,leading=1.5)
    box(d,(72,380,1008,697),(15,21,20),(47,60,53),7)
    txt(d,(96,403),"REQUEST PATH",8,MUTED,True,True);txt(d,(922,403),"01 → 04",8,DIM,False,True)
    line(d,(153,548,927,548),(77,117,83))
    items=[("AI","AI Agent","asks for stock records"),("K","KYROX MCP Server","FastMCP · Python · stdio"),("ƒ","list_stocks","no arguments required"),("{ }","Stock Records","local stocks.json")]
    xs=[93,325,557,789]
    for i,(icon,title,sub) in enumerate(items):
        x=xs[i]
        box(d,(x,465,x+175,617),(17,25,22),(79,105,83) if i==2 else LINE,6)
        txt(d,(x+15,477),f"0{i+1}",7,DIM,False,True)
        box(d,(x+70,490,x+105,525),(24,39,29),(92,129,95),6)
        txt(d,(x+87,507),icon,10,GREEN,True,True,"mm")
        txt(d,(x+87,555),title,10,PALE,True,False,"mm")
        txt(d,(x+87,581),sub,7,MUTED,False,False,"mm")
        if i<3: txt(d,(x+203,546),"→",18,GREEN,False,False,"mm")
    box(d,(72,740,1008,1082),(13,19,17),(47,60,53),6)
    line(d,(72,783,1008,783),(43,56,49))
    txt(d,(94,756),"TOOL RESPONSE / list_stocks",8,TEXT,False,True)
    txt(d,(870,756),"ARRAY · 3 ITEMS",7,(147,181,152),True,True)
    txt(d,(96,806),"TICKER",7,DIM,True,True);txt(d,(317,806),"NAME",7,DIM,True,True);txt(d,(552,806),"REFERENCE_VALUE",7,DIM,True,True);txt(d,(842,806),"DATA NOTE",7,DIM,True,True)
    rows=[("tAAPL","Test Apple","230.0"),("tTSLA","Test Tesla","250.0"),("tNVDA","Test Nvidia","140.0")]
    for i,(ticker,name,value) in enumerate(rows):
        y=843+i*62;line(d,(92,y,985,y),(35,46,41));txt(d,(96,y+20),ticker,10,GREEN,False,True);txt(d,(317,y+20),name,10,TEXT,False,True);txt(d,(552,y+20),value,10,PALE,False,True);txt(d,(842,y+20),"local fixture",8,MUTED,False,True)
    txt(d,(72,1134),"GET_STOCK_INFO LOOKS UP ONE TICKER",9,MUTED,True);line(d,(358,1140,938,1140),(42,58,48));txt(d,(962,1134),"04 — 05",9,MUTED,True,True)
    return im

def slide5():
    im,d=make_slide(5)
    txt(d,(72,215),"A DIRECTION, NOT A CLAIM",10,(151,178,160),True)
    txt(d,(72,256),"From local demo data",40,PALE,True);txt(d,(72,303),"toward",40,PALE,True);txt(d,(219,303),"external sources.",40,GREEN,True)
    wrap(d,"The current implementation is deliberately small. A future adapter could connect a financial-data provider while keeping the tool boundary explicit.",707,268,300,13,MUTED,leading=1.55)
    # Two-stage roadmap.
    line(d,(95,495,986,495),(75,107,77))
    for x in (95,538): circle(d,(x-5,490,x+5,500),BG,GREEN,2)
    box(d,(72,532,503,860),(19,29,23),(57,83,62),7)
    box(d,(577,532,1008,860),(15,21,18),(65,78,67),7)
    txt(d,(98,558),"NOW",8,GREEN,True,True);circle(d,(452,555,476,579),(27,45,31),(90,126,94));txt(d,(464,567),"✓",11,GREEN,True,False,"mm")
    txt(d,(98,610),"Local fixtures",20,PALE,True)
    wrap(d,"Three test records in stocks.json. Static reference values. No provider connected.",98,650,360,11,MUTED,leading=1.55)
    box(d,(98,778,216,806),(20,34,25),(53,75,55),3);txt(d,(108,787),"IMPLEMENTED",7,(162,208,171),True,True)
    txt(d,(604,558),"FUTURE DIRECTION",8,MUTED,True,True);circle(d,(926,555,950,579),(21,31,24),(82,100,85));txt(d,(938,567),"+",14,MUTED,False,False,"mm")
    txt(d,(604,610),"External data adapters",19,PALE,True)
    wrap(d,"Explore provider connections, provenance and freshness metadata before returning data to a tool.",604,650,360,11,MUTED,leading=1.55)
    box(d,(604,778,753,806),(20,28,23),(61,75,63),3);txt(d,(614,787),"NOT IMPLEMENTED",7,MUTED,True,True)
    box(d,(72,920,1008,1011),(17,26,20),(54,74,58),5)
    box(d,(94,944,125,975),GREEN,radius=5);txt(d,(103,950),"↗",15,(15,33,21))
    txt(d,(144,936),"Same clear boundary.",11,PALE,True);txt(d,(144,963),"Agent asks · KYROX validates · source returns structured records",9,MUTED)
    txt(d,(846,955),"ROADMAP CONCEPT",7,(154,180,160),True,True)
    txt(d,(72,1206),"BUILDING TOWARD GROUNDED DATA ACCESS",9,MUTED,True);line(d,(405,1212,938,1212),(42,58,48));txt(d,(962,1206),"05 — 05",9,MUTED,True,True)
    return im

builders=[slide1,slide2,slide3,slide4,slide5]
for i,build in enumerate(builders,1):
    im=build().resize((W,H),Image.Resampling.LANCZOS)
    im.save(OUT/f"slide-{i:02}.png",optimize=True)

tw,th,gap=324,405,20
preview=Image.new("RGB",(tw*2+gap*3,th*3+gap*4),"#080b0d")
for i in range(1,6):
    with Image.open(OUT/f"slide-{i:02}.png") as im:
        preview.paste(im.convert("RGB").resize((tw,th),Image.Resampling.LANCZOS),(gap+((i-1)%2)*(tw+gap),gap+((i-1)//2)*(th+gap)))
preview.save(ROOT/"preview.png",optimize=True)
print("Rendered five exact 1080x1350 PNGs and preview.png")
