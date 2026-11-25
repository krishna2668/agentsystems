package dev.worker.test;

import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.Color;
import android.media.MediaMetadataRetriever;
import java.io.*;

/** Decode six real video frames using Android's built-in decoder; no on-device AI.
 * The resulting JPEG is a sampling aid, never a substitute for watching motion.
 */
final class ReviewFrameCapture {
 private static final double[] RATIOS={0.12,0.22,0.30,0.42,0.62,0.86};
 static byte[] capture(File mp4)throws IOException{
  MediaMetadataRetriever retriever=new MediaMetadataRetriever();
  Bitmap sheet=null;
  try{
   retriever.setDataSource(mp4.getAbsolutePath());
   String length=retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION);
   long duration=Long.parseLong(length);
   if(duration<=0||duration>31000)throw new IOException("Review duration out of bounds");
   final int width=360,height=640;
   sheet=Bitmap.createBitmap(width*2,height*3,Bitmap.Config.ARGB_8888);
   Canvas canvas=new Canvas(sheet);
   Paint paint=new Paint(Paint.ANTI_ALIAS_FLAG|Paint.FILTER_BITMAP_FLAG);
   Paint label=new Paint(Paint.ANTI_ALIAS_FLAG);label.setColor(Color.WHITE);label.setTextSize(20f);
   Paint backdrop=new Paint();backdrop.setColor(0xB9000000);
   for(int i=0;i<RATIOS.length;i++){
    long at=Math.min(duration-1,Math.max(0,Math.round(duration*RATIOS[i])));
    Bitmap frame=retriever.getFrameAtTime(at*1000,MediaMetadataRetriever.OPTION_CLOSEST);
    if(frame==null)throw new IOException("Frame decode unavailable");
    int left=(i%2)*width,top=(i/2)*height;
    try{canvas.drawBitmap(frame,null,new android.graphics.Rect(left,top,left+width,top+height),paint);}
    finally{frame.recycle();}
    canvas.drawRect(left,top,left+115,top+30,backdrop);
    canvas.drawText(""+(i+1)+" · "+(at/1000.0)+"s",left+8,top+22,label);
   }
   ByteArrayOutputStream output=new ByteArrayOutputStream();
   for(int quality:new int[]{67,53,40}){
    output.reset();if(!sheet.compress(Bitmap.CompressFormat.JPEG,quality,output))throw new IOException("JPEG compression failed");
    if(output.size()<=ReviewSync.MAX_JPEG)return output.toByteArray();
   }
   throw new IOException("Review JPEG exceeds limit");
  }catch(RuntimeException e){throw new IOException("Media frame decode failed",e);}
  finally{if(sheet!=null)sheet.recycle();retriever.release();}
 }
}
