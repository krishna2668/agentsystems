"""Reference renderer for pilot 001; not yet an Android Worker capability."""
import json, math, random, subprocess, sys, wave, struct
from pathlib import Path
from PIL import Image, ImageDraw
ROOT=Path(__file__).resolve().parent
def validate(s):
    assert set(s)=={'version','title','width','height','fps','scenes'}
    assert s['version']==1 and (s['width'],s['height'],s['fps'])==(360,640,24)
    assert [x['beat'] for x in s['scenes']]==['establish','notice','approach','share']
    assert all(type(x['seconds']) is int and 1<=x['seconds']<=10 for x in s['scenes'])
    assert sum(x['seconds'] for x in s['scenes'])<=30
def frame(t,s):
    im=Image.new('RGB',(360,640),'#82999f'); d=ImageDraw.Draw(im)
    d.rectangle((0,360,360,640),fill='#53676c')
    d.rectangle((0,470,360,640),fill='#42565e')
    d.rectangle((22,213,338,230),fill='#32464e')
    d.rectangle((33,230,42,468),fill='#32464e');d.rectangle((318,230,327,468),fill='#32464e')
    d.rectangle((49,377,125,387),fill='#394b51')
    d.rectangle((54,387,62,435),fill='#394b51');d.rectangle((111,387,119,435),fill='#394b51')
    a,b,c=[sum(x['seconds'] for x in s['scenes'][:i]) for i in (1,2,3)]
    p=max(0,min(1,(t-b)/(c-b)));p=p*p*(3-2*p)
    x=91+137*p
    # Dog silhouette, constant proportions; motion is a small tail wag after shelter.
    dx=270; dy=456
    d.ellipse((dx-29,dy-22,dx+17,dy+5),fill='#b48962')
    d.ellipse((dx-39,dy-38,dx-10,dy-10),fill='#c49a70')
    d.polygon([(dx-36,dy-33),(dx-40,dy-50),(dx-25,dy-37)],fill='#72533f')
    d.ellipse((dx-35,dy-28,dx-31,dy-24),fill='#222d32')
    d.line((dx+13,dy-13,dx+32,dy-29+int(5*math.sin(t*9))*(t>=c)),fill='#b48962',width=6)
    for leg in (dx-19,dx+7):d.line((leg,dy,leg,dy+10),fill='#8c674f',width=7)
    # Child: stable outfit and proportions.
    bob=3*math.sin(t*9) if b<t<c else 0
    y=360+bob
    d.line((x-8,y+61,x-13,y+105),fill='#303e54',width=12)
    d.line((x+9,y+61,x+15,y+105),fill='#303e54',width=12)
    d.rounded_rectangle((x-22,y+10,x+22,y+66),radius=10,fill='#db9e42')
    d.ellipse((x-17,y-21,x+17,y+13),fill='#ae7856')
    d.pieslice((x-19,y-26,x+19,y+8),180,360,fill='#29323a')
    d.ellipse((x+7,y-6,x+10,y-3),fill='#222d32')
    ux=x+10+20*p; uy=y-66
    d.line((ux,uy+13,x+18,y+31),fill='#343f45',width=3)
    d.pieslice((ux-64,uy-29,ux+64,uy+37),180,360,fill='#e6bf59')
    d.line((ux-64,uy+4,ux+64,uy+4),fill='#94703a',width=3)
    rng=random.Random(17)
    for _ in range(115):
        rx=(rng.randrange(380)+int(t*31))%380-10; ry=(rng.randrange(680)+int(t*255))%680-20
        if abs(rx-ux)<64 and uy-16<ry<y+110:continue
        d.line((rx,ry,rx-5,ry+13),fill='#b3c5c8',width=1)
    return im
def render(s,out):
    validate(s);duration=sum(x['seconds'] for x in s['scenes'])
    audio=out.with_suffix('.wav');rng=random.Random(13)
    with wave.open(str(audio),'wb') as w:
        w.setparams((1,2,16000,0,'NONE','not compressed'))
        w.writeframes(b''.join(struct.pack('<h',rng.randrange(-650,651)) for _ in range(duration*16000)))
    cmd=['ffmpeg','-v','error','-y','-f','rawvideo','-pix_fmt','rgb24','-s','360x640','-r','24','-i','-','-i',str(audio),'-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac','-movflags','+faststart','-shortest',str(out)]
    proc=subprocess.Popen(cmd,stdin=subprocess.PIPE)
    try:
        for i in range(duration*24):proc.stdin.write(frame(i/24,s).tobytes())
    finally:proc.stdin.close()
    if proc.wait():raise RuntimeError('render failed')
    audio.unlink()
if __name__=='__main__':
    render(json.loads((ROOT/'pilot.json').read_text()),ROOT/'pilot.mp4')
