from PIL import Image, ImageDraw, ImageFont
S='screenshots/'
names=[('01-library','1 · 资源库 Library'),('02-pack-detail','2 · 教学包 Pack detail'),('03-request-a-pack','3 · 定制 Request a pack'),('04-my-classroom','4 · 我的教室 My Classroom'),('05-pricing','5 · 会员 Membership')]
tw=1040; th=int(900*tw/1440)
W=3*tw+4*50; H=230+2*(th+90)+80
c=Image.new('RGB',(W,H),'#FDF6EC'); d=ImageDraw.Draw(c)
fzh='/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc'
F1=ImageFont.truetype(fzh,64,index=2); F2=ImageFont.truetype(fzh,34,index=2); F3=ImageFont.truetype(fzh,28,index=2)
logo=Image.open('assets/logo-L4.jpg'); logo=logo.resize((int(logo.width*150/logo.height),150)); c.paste(logo,(50,40))
d.text((440,55),'Avery Studio 未来平台 · Future platform mockup',font=F1,fill='#42291D')
d.text((440,140),'Library → Pack detail → Request a pack → My Classroom → Membership   ·   2026-09-30   ·   MOCKUP, sample data',font=F3,fill='#6B5142')
for i,(n,lab) in enumerate(names):
    r,col=divmod(i,3)
    if r==1: col+=0.5
    x=int(50+col*(tw+50)); y=230+r*(th+90)
    d.text((x,y),lab,font=F2,fill='#42291D')
    im=Image.open(S+n+'-viewport.png').resize((tw,th),Image.LANCZOS)
    d.rounded_rectangle((x-4,y+48,x+tw+4,y+52+th),18,fill='#E8D6BE')
    c.paste(im,(x,y+50))
c.save(S+'00-overview.png'); print(c.size)
