package dev.worker.test;
import android.graphics.*;
import android.media.*;
import java.io.*;
import java.nio.ByteBuffer;
import java.util.Random;

/** Native, silent H.264 pilot renderer. Requires a flexible-YUV encoder on the actual Worker. */
final class AnimaticRenderer {
 static final int MAX_BYTES=2*1024*1024;
 private static final int W=AnimaticSpec.WIDTH,H=AnimaticSpec.HEIGHT,FPS=AnimaticSpec.FPS;
 interface Active {boolean allowed();}
 private static final class Drawing {
  final Bitmap bitmap=Bitmap.createBitmap(W,H,Bitmap.Config.ARGB_8888);
  final Canvas c=new Canvas(bitmap);
  final Paint p=new Paint(Paint.ANTI_ALIAS_FLAG);
  final int[] pixels=new int[W*H],rainX=new int[100],rainY=new int[100];
  Drawing(){Random r=new Random(17);for(int i=0;i<100;i++){rainX[i]=r.nextInt(380);rainY[i]=r.nextInt(680);}}
  void color(int v){p.setColor(0xff000000|v);}
  void rect(float x,float y,float xx,float yy,int v){color(v);c.drawRect(x,y,xx,yy,p);}
  void oval(float x,float y,float xx,float yy,int v){color(v);c.drawOval(x,y,xx,yy,p);}
  void line(float x,float y,float xx,float yy,float width,int v){color(v);p.setStrokeWidth(width);c.drawLine(x,y,xx,yy,p);}
  void draw(AnimaticSpec s,int frame){
   float t=frame/(float)FPS,progress=(float)s.progress(frame),x=91+137*progress;
   c.drawColor(0xff82999f);rect(0,360,W,H,0x53676c);rect(0,470,W,H,0x42565e);
   rect(22,213,338,230,0x32464e);rect(33,230,42,468,0x32464e);rect(318,230,327,468,0x32464e);
   rect(49,377,125,387,0x394b51);rect(54,387,62,435,0x394b51);rect(111,387,119,435,0x394b51);
   oval(241,434,287,461,0xb48962);oval(231,418,260,446,0xc49a70);
   color(0x72533f);Path ear=new Path();ear.moveTo(234,423);ear.lineTo(230,406);ear.lineTo(245,419);ear.close();c.drawPath(ear,p);
   oval(235,428,239,432,0x222d32);line(283,443,302,427+(progress>=1?5*(float)Math.sin(t*9):0),6,0xb48962);
   line(251,456,251,466,7,0x8c674f);line(277,456,277,466,7,0x8c674f);
   float y=360+(progress>0&&progress<1?3*(float)Math.sin(t*9):0);
   line(x-8,y+61,x-13,y+105,12,0x303e54);line(x+9,y+61,x+15,y+105,12,0x303e54);
   color(0xdb9e42);c.drawRoundRect(x-22,y+10,x+22,y+66,10,10,p);
   oval(x-17,y-21,x+17,y+13,0xae7856);color(0x29323a);c.drawArc(x-19,y-26,x+19,y+8,180,180,true,p);
   if(!s.noticeReaction){oval(x+7,y-6,x+10,y-3,0x222d32);}
   else{
    // Establish a forward-looking face, then turn toward the dog during noticing.
    float gaze=(float)s.gaze(frame);
    if(gaze<0.85f){float far=x-7+7*gaze;oval(far-1.8f,y-6,far+1.8f,y-2,0x222d32);}
    float near=x+5+4*gaze;oval(near-2,y-6,near+2,y-2,0x222d32);
    if(gaze>0.1f){line(near-3,y-10-gaze*2,near+3,y-10-gaze*2,1.4f,0x29323a);line(x+14,y+1,x+15+gaze*4,y+1,2,0xae7856);}
   }
   float ux=x+10+20*progress,uy=y-66;
   line(ux,uy+13,x+18,y+31,3,0x343f45);color(0xe6bf59);c.drawArc(ux-64,uy-29,ux+64,uy+37,180,180,true,p);
   for(int i=0;i<100;i++){int rx=(rainX[i]+(int)(t*31))%380-10,ry=(rainY[i]+(int)(t*255))%680-20;if(Math.abs(rx-ux)<64&&uy-16<ry&&ry<y+110)continue;line(rx,ry,rx-5,ry+13,1,0xb3c5c8);}
   bitmap.getPixels(pixels,0,W,0,0,W,H);
  }
 }
 private static int clamp(int x){return Math.max(0,Math.min(255,x));}
 private static void put(ByteBuffer b,int row,int stride,int x,int y,int value){b.put(y*row+x*stride,(byte)clamp(value));}
 private static void fill(Image im,int[] rgb){
  Image.Plane[] p=im.getPlanes();
  if(p.length!=3||im.getWidth()!=W||im.getHeight()!=H)throw new IllegalStateException("Unsupported encoder image");
  ByteBuffer yb=p[0].getBuffer(),ub=p[1].getBuffer(),vb=p[2].getBuffer();
  int yr=p[0].getRowStride(),ur=p[1].getRowStride(),vr=p[2].getRowStride(),ys=p[0].getPixelStride(),us=p[1].getPixelStride(),vs=p[2].getPixelStride();
  for(int y=0;y<H;y++)for(int x=0;x<W;x++){
   int v=rgb[y*W+x],r=(v>>16)&255,g=(v>>8)&255,b=v&255;
   put(yb,yr,ys,x,y,((66*r+129*g+25*b+128)>>8)+16);
   if((x&1)==0&&(y&1)==0){put(ub,ur,us,x/2,y/2,((-38*r-74*g+112*b+128)>>8)+128);put(vb,vr,vs,x/2,y/2,((112*r-94*g-18*b+128)>>8)+128);}
  }
 }
 private static MediaFormat format(){
  MediaFormat fmt=MediaFormat.createVideoFormat("video/avc",W,H);
  fmt.setInteger(MediaFormat.KEY_COLOR_FORMAT,MediaCodecInfo.CodecCapabilities.COLOR_FormatYUV420Flexible);
  fmt.setInteger(MediaFormat.KEY_BIT_RATE,350000);fmt.setInteger(MediaFormat.KEY_FRAME_RATE,FPS);fmt.setInteger(MediaFormat.KEY_I_FRAME_INTERVAL,2);
  return fmt;
 }
 static boolean supported(){try{return new MediaCodecList(MediaCodecList.REGULAR_CODECS).findEncoderForFormat(format())!=null;}catch(RuntimeException e){return false;}}
 static void render(AnimaticSpec s,File output,Active active)throws Exception{
  if(output.exists())throw new IOException("Output already exists");
  MediaFormat fmt=format();
  String name=new MediaCodecList(MediaCodecList.REGULAR_CODECS).findEncoderForFormat(fmt);
  if(name==null)throw new IOException("No compatible H.264 encoder");
  MediaCodec codec=MediaCodec.createByCodecName(name);MediaMuxer mux=null;boolean started=false,muxStarted=false,success=false;
  Drawing drawing=new Drawing();
  try{
   codec.configure(fmt,null,null,MediaCodec.CONFIGURE_FLAG_ENCODE);codec.start();started=true;
   mux=new MediaMuxer(output.getAbsolutePath(),MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4);
   int next=0,track=-1;boolean eosIn=false,eosOut=false;long deadline=android.os.SystemClock.elapsedRealtime()+120000;
   MediaCodec.BufferInfo info=new MediaCodec.BufferInfo();
   while(!eosOut){
    if(!active.allowed()||android.os.SystemClock.elapsedRealtime()>deadline)throw new InterruptedIOException("Render interrupted");
    if(!eosIn){int idx=codec.dequeueInputBuffer(5000);if(idx>=0){
     if(next==s.frames()){codec.queueInputBuffer(idx,0,0,next*1000000L/FPS,MediaCodec.BUFFER_FLAG_END_OF_STREAM);eosIn=true;}
     else{drawing.draw(s,next);Image im=codec.getInputImage(idx);if(im==null)throw new IOException("Encoder image unavailable");fill(im,drawing.pixels);codec.queueInputBuffer(idx,0,W*H*3/2,next*1000000L/FPS,0);next++;}
    }}
    int idx=codec.dequeueOutputBuffer(info,5000);
    if(idx==MediaCodec.INFO_OUTPUT_FORMAT_CHANGED){if(muxStarted)throw new IOException("Repeated output format");track=mux.addTrack(codec.getOutputFormat());mux.start();muxStarted=true;}
    else if(idx>=0){ByteBuffer buf=codec.getOutputBuffer(idx);if(info.size>0&&(info.flags&MediaCodec.BUFFER_FLAG_CODEC_CONFIG)==0){if(!muxStarted||buf==null)throw new IOException("Missing encoded output");buf.position(info.offset);buf.limit(info.offset+info.size);mux.writeSampleData(track,buf,info);}
     eosOut=(info.flags&MediaCodec.BUFFER_FLAG_END_OF_STREAM)!=0;codec.releaseOutputBuffer(idx,false);}
    if(output.length()>MAX_BYTES)throw new IOException("Artifact too large");
   }
   if(!muxStarted)throw new IOException("Missing track");mux.stop();muxStarted=false;
   if(output.length()==0||output.length()>MAX_BYTES)throw new IOException("Invalid artifact size");
   success=true;
  }finally{drawing.bitmap.recycle();if(started)try{codec.stop();}catch(Exception ignored){}codec.release();if(mux!=null){if(muxStarted)try{mux.stop();}catch(Exception ignored){}mux.release();}if(!success)output.delete();}
 }
}
