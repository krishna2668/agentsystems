package dev.worker.test;
import android.app.Activity;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.text.InputType;
import android.widget.*;
import java.net.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.security.*;
import java.security.spec.ECGenParameterSpec;
import java.util.Base64;
import java.util.UUID;
import java.util.concurrent.Executors;
import java.util.concurrent.ExecutorService;
import org.json.JSONObject;

public final class MainActivity extends Activity {
 private static final String ALIAS="worker-test-v04";
 private static final String GATEWAY="https://gateway.example.invalid";
 private static final String ALPHABET="ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
 private static final ExecutorService executor=Executors.newSingleThreadExecutor();
 private SharedPreferences prefs;
 private TextView heading,description,status,displayCode;
 private Button connect,copy,run;
 private boolean busy=false, visible=false, resumed=false;
 private final StartIntent startIntent=new StartIntent();
 private static final int NOTIFICATION_REQUEST=61;
 private volatile long retryAfter=0;
 private final Handler handler=new Handler(Looper.getMainLooper());
 private final Runnable refreshTick=new Runnable(){public void run(){
   if(!visible||isDestroyed())return;
   refresh();
   if(!paired()&&!busy&&prefs.contains("request_id")&&System.currentTimeMillis()>=retryAfter)request(false);
   handler.postDelayed(this,2000);
 }};
 @Override protected void onStart(){super.onStart();visible=true;handler.post(refreshTick);}
 @Override protected void onResume(){super.onResume();resumed=true;continueStart();}
 @Override protected void onPause(){resumed=false;super.onPause();}
 @Override protected void onSaveInstanceState(Bundle state){super.onSaveInstanceState(state);state.putInt("worker_start_intent",startIntent.state());}
 @Override protected void onStop(){visible=false;handler.removeCallbacks(refreshTick);super.onStop();}
 private TextView text(LinearLayout root,float size){TextView t=new TextView(this);t.setTextSize(size);root.addView(t);return t;}
 private Button button(LinearLayout root,String label){Button b=new Button(this);b.setText(label);root.addView(b);return b;}
 @Override public void onCreate(Bundle state){
   super.onCreate(state);prefs=getSharedPreferences("worker_v04",MODE_PRIVATE);
   if(state!=null)startIntent.restore(state.getInt("worker_start_intent",0));
   ScrollView scroll=new ScrollView(this);LinearLayout root=new LinearLayout(this);
   root.setOrientation(1);int pad=(int)(24*getResources().getDisplayMetrics().density);root.setPadding(pad,pad,pad,pad);
   scroll.addView(root);setContentView(scroll);
   heading=text(root,28);description=text(root,16);status=text(root,16);displayCode=text(root,26);
   displayCode.setTextIsSelectable(true);
   connect=button(root,"Connect this Worker");copy=button(root,"Copy request code");run=button(root,"Start worker");
   connect.setOnClickListener(v->request(true));
   copy.setOnClickListener(v->{if(!prefs.contains("request_id")||!prefs.getBoolean("request_registered",false)||paired())return;
     if(prefs.getLong("request_expiry",0)<=System.currentTimeMillis()/1000)return;
     android.content.ClipboardManager clipboard=(android.content.ClipboardManager)getSystemService(CLIPBOARD_SERVICE);
     clipboard.setPrimaryClip(android.content.ClipData.newPlainText("Worker request code",formatCode(prefs.getString("request_code",""))));
     Toast.makeText(this,"Request code copied",Toast.LENGTH_SHORT).show();});
   run.setOnClickListener(v->{
     if(WorkerService.active){startIntent.cancel();WorkerService.requestPause(this);status.setText("Pausing…");return;}
     if(!paired())return;
     if(android.os.Build.VERSION.SDK_INT>=33&&checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS)!=android.content.pm.PackageManager.PERMISSION_GRANTED){
       if(!startIntent.requestPermission())return;
       requestPermissions(new String[]{android.Manifest.permission.POST_NOTIFICATIONS},NOTIFICATION_REQUEST);return;
     }
     startIntent.requestStart();continueStart();
   });refresh();
 }
 @Override public void onRequestPermissionsResult(int requestCode,String[] permissions,int[] grantResults){
   super.onRequestPermissionsResult(requestCode,permissions,grantResults);
   if(requestCode!=NOTIFICATION_REQUEST)return;
   boolean granted=grantResults.length==1&&grantResults[0]==android.content.pm.PackageManager.PERMISSION_GRANTED;
   if(!startIntent.permissionResult(granted))return;
   if(!granted){prefs.edit().putString("service_status","Notification permission not granted · tap Start to try again").apply();refresh();return;}
   continueStart();
 }
 private void continueStart(){
   if(!startIntent.consume(resumed&&visible,paired(),WorkerService.active))return;
   try{startForegroundService(new android.content.Intent(this,WorkerService.class).setAction(WorkerService.START));status.setText("Starting worker…");}
   catch(RuntimeException e){prefs.edit().putString("service_status","Android restricted service start").apply();refresh();}
 }
 private boolean paired(){return prefs.contains("id")&&GATEWAY.equals(prefs.getString("base",""));}
 private boolean legacy(){return prefs.contains("id")&&!paired();}
 private static String formatCode(String code){return code.length()==12?code.substring(0,4)+"-"+code.substring(4,8)+"-"+code.substring(8):"";}
 private void refresh(){
   boolean connected=paired(), pending=prefs.contains("request_id"), registered=prefs.getBoolean("request_registered",false);
   long remaining=prefs.getLong("request_expiry",0)-System.currentTimeMillis()/1000;
   heading.setText(connected?(prefs.getBoolean("authorization_blocked",false)?"Authorization blocked":"Worker connected"):"Connect a Worker");
   description.setText(connected?"This device receives authorized work from your system.":legacy()?"An existing connection uses a different gateway. It has not been changed.":pending?"Authorize this device on the Workers page. The connection completes automatically.":"Request a connection to your system.");
   String saved=prefs.getString("service_status","");
   status.setText(connected?(WorkerService.active?saved:"Not running"+(saved.isEmpty()?"":" · "+saved)):
     pending&&registered&&remaining>0?(saved.startsWith("Connection")?saved:"Waiting for authorization · "+((remaining+59)/60)+" min remaining"):pending?(busy?"Requesting connection…":saved.isEmpty()?"Checking request…":saved):saved.isEmpty()?"Not connected":saved);
   boolean show=pending&&registered&&remaining>0&&!connected;
   displayCode.setVisibility(show?android.view.View.VISIBLE:android.view.View.GONE);
   displayCode.setText(show?formatCode(prefs.getString("request_code","")):"");
   copy.setVisibility(show?android.view.View.VISIBLE:android.view.View.GONE);
   connect.setVisibility(!connected&&!legacy()?android.view.View.VISIBLE:android.view.View.GONE);
   connect.setEnabled(!busy);connect.setText(pending?"Check connection":"Connect this Worker");
   run.setVisibility(connected?android.view.View.VISIBLE:android.view.View.GONE);
   run.setText(WorkerService.active?"Pause worker":prefs.getBoolean("authorization_blocked",false)?"Check authorization":"Start worker");
 }
 private void request(boolean manual){
   if(busy||paired()||legacy())return;
   if(!prefs.contains("request_id")){
     if(!manual)return;
     SecureRandom rnd=new SecureRandom();StringBuilder b=new StringBuilder();for(int i=0;i<12;i++)b.append(ALPHABET.charAt(rnd.nextInt(ALPHABET.length())));
     if(!prefs.edit().putString("request_id",UUID.randomUUID().toString()).putString("request_code",b.toString()).putBoolean("request_registered",false).remove("request_expiry").remove("service_status").commit()){
       status.setText("Unable to save the connection request.");return;
     }
   }
   final String rid=prefs.getString("request_id",""), code=prefs.getString("request_code","");
   busy=true;refresh();
   executor.execute(()->{
     String message="";
     try{
       KeyStore ks=identity(true);
       String pub=Base64.getEncoder().encodeToString(ks.getCertificate(ALIAS).getPublicKey().getEncoded());
       JSONObject result;
       if(prefs.getBoolean("request_registered",false)){
         String stamp=Long.toString(System.currentTimeMillis()/1000);
         String proof=sign(String.join("\n","worker-enroll-v1:status",rid,stamp).getBytes(StandardCharsets.UTF_8));
         JSONObject body=new JSONObject().put("request_id",rid).put("timestamp",stamp).put("proof",proof);
         result=new JSONObject(post(GATEWAY,"/enrollment/status",body.toString(),null));
       }else{
         String stamp=Long.toString(System.currentTimeMillis()/1000);
         String proof=sign(String.join("\n","worker-enroll-v1:start",rid,code,pub,stamp).getBytes(StandardCharsets.UTF_8));
         JSONObject body=new JSONObject().put("request_id",rid).put("code",code).put("public_key",pub).put("timestamp",stamp).put("proof",proof);
         result=new JSONObject(post(GATEWAY,"/enrollment/start",body.toString(),null));
       }
       if("approved".equals(result.getString("state"))){
         String id=result.getString("device_id");
         if(!id.matches("[a-f0-9-]{36}")||!prefs.edit().putString("id",id).putString("base",GATEWAY).remove("request_id").remove("request_code").remove("request_expiry").remove("request_registered").putString("service_status","Ready").commit())throw new IOException("Connection persistence unconfirmed");
         message="Ready";
       }else if("pending".equals(result.getString("state"))){
         if(!prefs.edit().putBoolean("request_registered",true).putLong("request_expiry",result.getLong("expires_at")).commit())throw new IOException("Request persistence unconfirmed");
         message="Waiting for authorization";
       }else throw new IOException("Unexpected enrollment state");
     }catch(HttpFailure e){
       if(e.code==410){prefs.edit().remove("request_id").remove("request_code").remove("request_expiry").remove("request_registered").commit();message="Request expired. Connect again to generate a new code.";}
       else if(e.code==404&&prefs.getBoolean("request_registered",false)){prefs.edit().putBoolean("request_registered",false).commit();message="Rechecking connection request.";}
       else if(e.code==403){message="Connection authorization denied or revoked.";retryAfter=System.currentTimeMillis()+30000;}
       else if(e.code==409){message="Connection conflict. Existing identity preserved.";retryAfter=System.currentTimeMillis()+30000;}
       else{message="Connection not confirmed. Retrying when online.";retryAfter=System.currentTimeMillis()+10000;}
     }catch(Exception e){message="Connection not confirmed. Retrying when online.";retryAfter=System.currentTimeMillis()+10000;}
     prefs.edit().putString("service_status",message).apply();
     runOnUiThread(()->{busy=false;if(!isDestroyed())refresh();});
   });
 }
 private static KeyStore store()throws Exception{KeyStore ks=KeyStore.getInstance("AndroidKeyStore");ks.load(null);return ks;}
 private static KeyStore identity(boolean create)throws Exception{
  KeyStore ks=store();
  if(!ks.containsAlias(ALIAS)){
   if(!create)throw new KeyStoreException("Missing enrolled key");
   KeyPairGenerator gen=KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC,"AndroidKeyStore");
   gen.initialize(new KeyGenParameterSpec.Builder(ALIAS,KeyProperties.PURPOSE_SIGN|KeyProperties.PURPOSE_VERIFY).setAlgorithmParameterSpec(new ECGenParameterSpec("secp256r1")).setDigests(KeyProperties.DIGEST_SHA256).build());gen.generateKeyPair();ks=store();
  }return ks;
 }
 private static String sign(byte[] data)throws Exception{
  Signature s=Signature.getInstance("SHA256withECDSA");s.initSign((PrivateKey)identity(false).getKey(ALIAS,null));s.update(data);return Base64.getEncoder().encodeToString(s.sign());
 }
 private static String hash(byte[] bytes)throws Exception{
  StringBuilder hex=new StringBuilder();for(byte b:MessageDigest.getInstance("SHA-256").digest(bytes))hex.append(String.format(java.util.Locale.ROOT,"%02x",b&255));return hex.toString();
 }
 static String post(String base,String path,String body,String id)throws Exception{
  byte[] raw=body==null?new byte[0]:body.getBytes(StandardCharsets.UTF_8);
  HttpURLConnection c=(HttpURLConnection)new URL(base+path).openConnection();
  c.setInstanceFollowRedirects(false);c.setRequestMethod("POST");c.setConnectTimeout(10000);c.setReadTimeout(10000);
  if(id!=null){String stamp=Long.toString(System.currentTimeMillis()/1000),nonce=UUID.randomUUID().toString();
   String message=String.join("\n",id,"POST",path,stamp,nonce,hash(raw));
   c.setRequestProperty("X-Device",id);c.setRequestProperty("X-Timestamp",stamp);c.setRequestProperty("X-Nonce",nonce);c.setRequestProperty("X-Signature",sign(message.getBytes(StandardCharsets.UTF_8)));
  }
  try{
   if(body!=null){c.setDoOutput(true);c.setRequestProperty("Content-Type","application/json");try(OutputStream out=c.getOutputStream()){out.write(raw);}}
   int response=c.getResponseCode();if(response<200||response>=300)throw new HttpFailure(response);
   try(InputStream in=c.getInputStream();ByteArrayOutputStream out=new ByteArrayOutputStream()){
    byte[] buf=new byte[4096];int n;while((n=in.read(buf))!=-1){if(out.size()+n>400000)throw new IOException("Response too large");out.write(buf,0,n);}return new String(out.toByteArray(),StandardCharsets.UTF_8);
   }
  }finally{c.disconnect();}
 }
 static final class HttpFailure extends IOException{
  final int code;HttpFailure(int code){super("HTTP "+code);this.code=code;}
 }
 @Override protected void onDestroy(){handler.removeCallbacks(refreshTick);super.onDestroy();}
}
