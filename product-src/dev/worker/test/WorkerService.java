package dev.worker.test;
import android.app.*;
import android.content.*;
import android.os.*;
import android.content.pm.ServiceInfo;
import java.io.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicBoolean;
import org.json.JSONObject;

/** Explicitly user-started bounded TEST file-processing session. */
public final class WorkerService extends Service {
 static final String START="dev.worker.test.START",PAUSE="dev.worker.test.PAUSE";
 static volatile boolean active=false;
 private static final AtomicBoolean busy=new AtomicBoolean();
 private static final ExecutorService executor=Executors.newSingleThreadExecutor();
 private final Handler handler=new Handler(Looper.getMainLooper());
 private final Runnable tick=this::poll;
 private static final int NOTIFICATION=61;
 private static final String CHANNEL="worker-production";
 private SharedPreferences prefs;
 private volatile boolean running=false;
 private int failures=0;
 private long started,idleSince;
 static boolean quiescent(){return !active&&!busy.get();}
 static void requestPause(Context c){
  c.getSharedPreferences("worker_v04",MODE_PRIVATE).edit().putString("service_status","Paused · saved work retained").apply();
  c.stopService(new Intent(c,WorkerService.class));
 }
 @Override public void onCreate(){
  super.onCreate();prefs=getSharedPreferences("worker_v04",MODE_PRIVATE);
  getSystemService(NotificationManager.class).createNotificationChannel(new NotificationChannel(CHANNEL,"Worker production",NotificationManager.IMPORTANCE_LOW));
 }
 private Notification notification(String text){
  PendingIntent open=PendingIntent.getActivity(this,1,new Intent(this,MainActivity.class),PendingIntent.FLAG_IMMUTABLE|PendingIntent.FLAG_UPDATE_CURRENT);
  PendingIntent pause=PendingIntent.getService(this,2,new Intent(this,WorkerService.class).setAction(PAUSE),PendingIntent.FLAG_IMMUTABLE|PendingIntent.FLAG_UPDATE_CURRENT);
  return new Notification.Builder(this,CHANNEL).setSmallIcon(android.R.drawable.stat_notify_sync).setContentTitle("AgentSystems Worker").setContentText(text).setContentIntent(open).setOngoing(true).addAction(new Notification.Action.Builder(android.R.drawable.ic_media_pause,"Pause",pause).build()).build();
 }
 private void status(String text){
  prefs.edit().putString("service_status",text).apply();
  if(running)getSystemService(NotificationManager.class).notify(NOTIFICATION,notification(text));
 }
 @Override public int onStartCommand(Intent intent,int flags,int id){
  if(intent==null||PAUSE.equals(intent.getAction())){stop("Paused · saved work retained");return START_NOT_STICKY;}
  if(running)return START_NOT_STICKY;
  if(!START.equals(intent.getAction())||!prefs.contains("id")){stopSelf();return START_NOT_STICKY;}
  try{
   if(Build.VERSION.SDK_INT>=35)startForeground(NOTIFICATION,notification("Starting"),ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC|ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROCESSING);
   else if(Build.VERSION.SDK_INT>=29)startForeground(NOTIFICATION,notification("Starting"),ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);
   else startForeground(NOTIFICATION,notification("Starting"));
  }catch(RuntimeException e){status("Android restricted service start");stopSelf();return START_NOT_STICKY;}
  active=true;running=true;status("Production running");started=SystemClock.elapsedRealtime();idleSince=0;failures=0;schedule(0);
  return START_NOT_STICKY;
 }
 private void schedule(long ms){handler.removeCallbacks(tick);if(running)handler.postDelayed(tick,ms);}
 private void stop(String reason){running=false;active=false;handler.removeCallbacks(tick);status(reason);stopForeground(STOP_FOREGROUND_REMOVE);stopSelf();}
 @Override public void onTimeout(int startId,int type){stop("Android time limit reached · reopen to resume");}
 @Override public void onDestroy(){running=false;active=false;handler.removeCallbacks(tick);super.onDestroy();}
 @Override public IBinder onBind(Intent i){return null;}
 private void poll(){
  if(!running)return;
  long now=SystemClock.elapsedRealtime();
  // Deliberately bounded TEST sessions; do not keep an idle service alive indefinitely.
  if(now-started>=15*60*1000L){stop("TEST session limit · reopen to resume");return;}
  if(idleSince!=0&&now-idleSince>=30000){stop("Queue idle · start again when work is ready");return;}
  PowerManager power=getSystemService(PowerManager.class);
  if(Build.VERSION.SDK_INT>=29 && power.getCurrentThermalStatus()>=PowerManager.THERMAL_STATUS_SEVERE){status("Thermal pause · waiting for cooling");schedule(30000);return;}
  if(getFilesDir().getUsableSpace()<16*1024*1024L){stop("Low storage · saved work retained");return;}
  if(!busy.compareAndSet(false,true)){schedule(1000);return;}
  final String base=prefs.getString("base",""),id=prefs.getString("id","");
  status("Checking work");
  executor.execute(()->{
   String result=null;Exception failure=null;
   try{
    final String[] firstClaim={null};
    Execution.Remote remote=new Execution.Remote(){
     private String post(String path,String body)throws Exception{return signedPost(base,id,path,body);}
     public String claim()throws Exception{return firstClaim[0]!=null?firstClaim[0]:post("/worker/claim",null);}
     private Execution.Recovery response(String raw)throws Exception{
      JSONObject j=new JSONObject(raw);String state=j.getString("status");
      return new Execution.Recovery(state,j.getString("job_id"),j.getString("completed".equals(state)?"sha256":"lease"));
     }
     public Execution.Recovery recover(String job,String lease)throws Exception{return response(post("/worker/jobs/"+job+"/recover",new JSONObject().put("lease",lease).toString()));}
     public Execution.Recovery complete(String job,String lease,String digest)throws Exception{return response(post("/worker/jobs/"+job+"/complete",new JSONObject().put("lease",lease).put("sha256",digest).toString()));}
    };
    File hashFile=new File(getFilesDir(),"checkpoint-v1");
    Execution hash=new Execution(new Execution.Store(hashFile.toPath()),remote);
    MediaExecution media=new MediaExecution(getFilesDir().toPath(),new MediaExecution.Remote(){
     public Execution.Recovery recover(String job,String lease)throws Exception{return remote.recover(job,lease);}
     public void chunk(String job,String lease,int seq,byte[] bytes)throws Exception{
      JSONObject response=new JSONObject(signedPost(base,id,"/worker/jobs/"+job+"/chunk",new JSONObject().put("lease",lease).put("seq",seq).put("bytes_b64",java.util.Base64.getEncoder().encodeToString(bytes)).toString()));
      if(!"uploaded".equals(response.getString("status"))||response.getInt("seq")!=seq)throw new IOException("Media chunk unconfirmed");
     }
     public Execution.Recovery rejectProject(String job,String lease)throws Exception{
      JSONObject response=new JSONObject(signedPost(base,id,"/worker/jobs/"+job+"/reject_project",new JSONObject().put("lease",lease).toString()));
      return new Execution.Recovery(response.getString("status"),response.getString("job_id"),response.getString("lease"));
     }
     public String finish(String job,String lease,int count,String digest)throws Exception{
      JSONObject response=new JSONObject(signedPost(base,id,"/worker/jobs/"+job+"/finish",new JSONObject().put("lease",lease).put("count",count).put("sha256",digest).toString()));
      if(!"completed".equals(response.getString("status")))throw new IOException("Media completion unconfirmed");
      return response.getString("sha256");
     }
    },(spec,out)->AnimaticRenderer.render(spec,out,()->running&&(Build.VERSION.SDK_INT<29||getSystemService(PowerManager.class).getCurrentThermalStatus()<PowerManager.THERMAL_STATUS_SEVERE)));
    ReviewSync review=new ReviewSync(getFilesDir().toPath(),p->ReviewFrameCapture.capture(p.toFile()),(job,source,digest,jpeg)->{
      String body=new JSONObject().put("source_sha256",source).put("sha256",digest).put("image_b64",java.util.Base64.getEncoder().encodeToString(jpeg)).toString();
      JSONObject reply=new JSONObject(signedPost(base,id,"/worker/jobs/"+job+"/review-stills",body));
      if(!digest.equals(reply.optString("sha256")))throw new IOException("Review upload unconfirmed");
    });
    if(hashFile.exists())result=hash.step();
    else if(media.pending()){
     try{result=media.step();}
     catch(MainActivity.HttpFailure e){
      if(e.code!=409)throw e;
      MediaExecution.Claim saved=media.load();
      String claimed=claimMedia(base,id);
      if(claimed.isEmpty())throw e;
      MediaExecution.Claim renewed=new MediaExecution.Claim(claimed);
      if(saved==null||!saved.job.equals(renewed.job)||!saved.payload.equals(renewed.payload)||!MediaExecution.CAPABILITY.equals(renewed.capability)||saved.lease.equals(renewed.lease))throw e;
      media.save(renewed);result=media.step();
     }
    }else if(AnimaticRenderer.supported()){
     String claimed;
     try{claimed=claimMedia(base,id);}
     catch(MainActivity.HttpFailure e){if(e.code!=404)throw e;claimed=null;}
     if(claimed==null)result=hash.step();
     else if(!claimed.isEmpty()){
      MediaExecution.Claim c=new MediaExecution.Claim(claimed);
      if(MediaExecution.CAPABILITY.equals(c.capability)){media.save(c);result=media.step();}
      else{firstClaim[0]=c.legacy();result=hash.step();}
     }
    }else result=hash.step();
    // Backfill previously completed media too. Review failure never reverses a
    // confirmed render, and no screenshot is taken from the app's UI.
    if(result==null){String reviewJob=review.step();if(reviewJob!=null)result="review:"+reviewJob;}
   }catch(Exception e){failure=e;}finally{busy.set(false);}
   final String completed=result;final Exception error=failure;
   handler.post(()->finished(completed,error));
  });
 }
 private String claimMedia(String base,String id)throws Exception{
  try{return signedPost(base,id,"/worker/claim-v3",null);}catch(MainActivity.HttpFailure e){if(e.code!=404)throw e;return signedPost(base,id,"/worker/claim-v2",null);}
 }
 private String signedPost(String base,String id,String path,String body)throws Exception{if(!running)throw new InterruptedIOException("Session stopped");return MainActivity.post(base,path,body,id);}
 private void finished(String result,Exception e){
  if(!running)return;
  if(e==null){
   prefs.edit().remove("authorization_blocked").apply();failures=0;if(result==null){if(idleSince==0)idleSince=SystemClock.elapsedRealtime();status("Queue idle · checking briefly");schedule(3000);}
   else{idleSince=0;status(result.startsWith("blocked:")?"Project revision blocked · local project unavailable":result.startsWith("review:")?"Visual review ready · original video retained":"Result stored · "+result);schedule(1000);}return;
  }
  boolean blocked=false;
  if(e instanceof MainActivity.HttpFailure){int c=((MainActivity.HttpFailure)e).code;if(c==401||c==403)prefs.edit().putBoolean("authorization_blocked",true).apply();blocked=c==401||c==403||c==404||c==409||c==422;}
  if(e instanceof IOException&&e.getMessage()!=null){String m=e.getMessage().toLowerCase(java.util.Locale.ROOT);blocked|=m.contains("checkpoint")||m.contains("unconfirmed")||m.contains("mismatch");}
  if(blocked){stop("Blocked · saved work retained");return;}
  idleSince=0;failures=Math.min(failures+1,5);status("Interrupted · saved work retained · retrying");schedule(Math.min(60000,3000L*(1L<<failures)));
 }
}
