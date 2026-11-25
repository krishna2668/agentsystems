package dev.worker.test;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.security.MessageDigest;
import java.util.Base64;
import java.util.Locale;

/** Single executor, single device checkpoint. No Android or network dependency. */
final class Execution {
 interface Remote {
  String claim() throws Exception;
  Recovery recover(String job,String lease) throws Exception;
  Recovery complete(String job,String lease,String digest) throws Exception;
 }
 static final class Recovery {
  final String state,job,proof;
  Recovery(String state,String job,String proof){this.state=state;this.job=job;this.proof=proof;}
 }
 static final class Checkpoint {
  final String job,lease,payload,result;
  Checkpoint(String job,String lease,String payload,String result)throws IOException{
   if(!job.matches("[a-f0-9-]{36}")||!lease.matches("[a-f0-9-]{36}")||payload.length()>349528||(!result.isEmpty()&&!result.matches("[a-f0-9]{64}")))throw new IOException("Invalid checkpoint");
   try{if(Base64.getDecoder().decode(payload).length>262144)throw new IOException("Input too large");}catch(IllegalArgumentException e){throw new IOException("Invalid payload",e);}
   this.job=job;this.lease=lease;this.payload=payload;this.result=result;
  }
  static Checkpoint fromClaim(String claim)throws IOException{
   String[] f=claim.split("\t",-1);if(f.length!=3)throw new IOException("Invalid claim");
   return new Checkpoint(f[0],f[1],f[2],"");
  }
  Checkpoint compute()throws Exception{
   String actual=hash(Base64.getDecoder().decode(payload));
   if(!result.isEmpty()&&!result.equals(actual))throw new IOException("Checkpoint digest mismatch");
   return new Checkpoint(job,lease,payload,actual);
  }
 }
 static final class Store {
  private final Path file;
  Store(Path file){this.file=file;}
  Checkpoint load()throws IOException{
   if(!Files.exists(file))return null;
   if(Files.size(file)>400000)throw new IOException("Checkpoint too large");
   String[] f=new String(Files.readAllBytes(file),StandardCharsets.UTF_8).split("\n",-1);
   if(f.length!=5||!f[0].equals("worker-checkpoint-v1"))throw new IOException("Invalid checkpoint version");
   return new Checkpoint(f[1],f[2],f[3],f[4]);
  }
  void save(Checkpoint c)throws IOException{
   Path tmp=file.resolveSibling(file.getFileName()+".tmp");
   try(FileOutputStream out=new FileOutputStream(tmp.toFile())){
    out.write(String.join("\n","worker-checkpoint-v1",c.job,c.lease,c.payload,c.result).getBytes(StandardCharsets.UTF_8));out.getFD().sync();
   }
   Files.move(tmp,file,StandardCopyOption.ATOMIC_MOVE,StandardCopyOption.REPLACE_EXISTING);
  }
  void clear()throws IOException{Files.deleteIfExists(file);}
 }
 static String hash(byte[] bytes)throws Exception{
  StringBuilder h=new StringBuilder();for(byte b:MessageDigest.getInstance("SHA-256").digest(bytes))h.append(String.format(Locale.ROOT,"%02x",b&255));return h.toString();
 }
 private final Store store;private final Remote remote;
 Execution(Store store,Remote remote){this.store=store;this.remote=remote;}
 /** Returns null for empty queue. Never clears an unconfirmed result. */
 String step()throws Exception{
  Checkpoint c=store.load();
  if(c==null){
   String claim=remote.claim();if(claim.isEmpty())return null;
   c=Checkpoint.fromClaim(claim);store.save(c);
  }
  c=c.compute();store.save(c);
  Recovery r=remote.recover(c.job,c.lease);
  if(!c.job.equals(r.job))throw new IOException("Recovery job mismatch");
  if("claimed".equals(r.state)&&c.lease.equals(r.proof))r=remote.complete(c.job,c.lease,c.result);
  if(!"completed".equals(r.state)||!c.job.equals(r.job)||!c.result.equals(r.proof))throw new IOException("Completion unconfirmed");
  store.clear();return c.job;
 }
}
