package dev.worker.test;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.Base64;
import java.util.Arrays;

/** Retain the actual artifact until its completion is confirmed. */
final class MediaExecution {
 static final String CAPABILITY="media.animatic.render";
 static final int CHUNK=65536,MAX_BYTES=32*CHUNK;
 interface Remote {
  Execution.Recovery recover(String job,String lease)throws Exception;
  void chunk(String job,String lease,int seq,byte[] bytes)throws Exception;
  String finish(String job,String lease,int count,String digest)throws Exception;
 }
 interface Render {void render(AnimaticSpec s,File out)throws Exception;}
 static final class Claim {
  final String job,lease,capability,payload;
  Claim(String raw)throws IOException{
   String[] v=raw.split("\t",-1);
   if(v.length!=4||!v[0].matches("[a-f0-9-]{36}")||!v[1].matches("[a-f0-9-]{36}")||!(CAPABILITY.equals(v[2])||"file.sha256".equals(v[2])))throw new IOException("Invalid claim");
   job=v[0];lease=v[1];capability=v[2];payload=v[3];
   if(CAPABILITY.equals(capability))spec();
  }
  AnimaticSpec spec()throws IOException{
   try{if(payload.length()>64)throw new IllegalArgumentException();return AnimaticSpec.parse(new String(Base64.getDecoder().decode(payload),StandardCharsets.UTF_8));}catch(IllegalArgumentException e){throw new IOException("Invalid media spec",e);}
  }
  String raw(){return String.join("\t",job,lease,capability,payload);}
  String legacy(){return String.join("\t",job,lease,payload);}
 }
 private final Path meta,artifact,part;
 private final ArtifactLibrary library;
 private final Remote remote;private final Render renderer;
 MediaExecution(Path dir,Remote remote,Render renderer){
  library=new ArtifactLibrary(dir);
  meta=dir.resolve("media-checkpoint-v1");artifact=dir.resolve("media-artifact-v1.mp4");part=dir.resolve("media-artifact-v1.part.mp4");this.remote=remote;this.renderer=renderer;
 }
 boolean pending(){return Files.exists(meta);}
 Claim load()throws IOException{
  if(!pending())return null;
  if(Files.size(meta)>512)throw new IOException("Invalid media checkpoint");
  Claim c=new Claim(new String(Files.readAllBytes(meta),StandardCharsets.UTF_8));
  if(!CAPABILITY.equals(c.capability))throw new IOException("Invalid media checkpoint capability");
  return c;
 }
 void save(Claim c)throws IOException{
  if(!CAPABILITY.equals(c.capability))throw new IOException("Invalid media claim");
  Claim old=load();
  if(old!=null&&(!old.job.equals(c.job)||!old.payload.equals(c.payload)))throw new IOException("Media checkpoint mismatch");
  if(old==null){Files.deleteIfExists(artifact);Files.deleteIfExists(part);}
  Path tmp=meta.resolveSibling(meta.getFileName()+".tmp");
  try(FileOutputStream out=new FileOutputStream(tmp.toFile())){out.write(c.raw().getBytes(StandardCharsets.UTF_8));out.getFD().sync();}
  Files.move(tmp,meta,StandardCopyOption.REPLACE_EXISTING,StandardCopyOption.ATOMIC_MOVE);
 }
 String step()throws Exception{
  Claim c=load();if(c==null)return null;
  Execution.Recovery r=remote.recover(c.job,c.lease);
  if(!c.job.equals(r.job))throw new IOException("Media recovery mismatch");
  if(!Files.exists(artifact)){
   if("completed".equals(r.state))throw new IOException("Completed media checkpoint missing artifact");
   checkClaim(r,c);Files.deleteIfExists(part);renderer.render(c.spec(),part.toFile());
   if(Files.size(part)==0||Files.size(part)>MAX_BYTES)throw new IOException("Invalid media artifact size");
   try(RandomAccessFile file=new RandomAccessFile(part.toFile(),"rw")){file.getFD().sync();}
   Files.move(part,artifact,StandardCopyOption.ATOMIC_MOVE);
  }
  long size=Files.size(artifact);if(size<=0||size>MAX_BYTES)throw new IOException("Invalid media artifact size");
  byte[] data=Files.readAllBytes(artifact);String digest=Execution.hash(data);
  if(!"completed".equals(r.state)){
   checkClaim(r,c);r=remote.recover(c.job,c.lease);
   if(!c.job.equals(r.job))throw new IOException("Media recovery mismatch");
   if(!"completed".equals(r.state)){
    checkClaim(r,c);int count=(data.length+CHUNK-1)/CHUNK;
    for(int i=0;i<count;i++)remote.chunk(c.job,c.lease,i,Arrays.copyOfRange(data,i*CHUNK,Math.min(data.length,(i+1)*CHUNK)));
    r=new Execution.Recovery("completed",c.job,remote.finish(c.job,c.lease,count,digest));
   }
  }
  if(!"completed".equals(r.state)||!digest.equals(r.proof))throw new IOException("Media completion unconfirmed");
  // Publish before clearing the checkpoint; a restart safely retries publication.
  library.publish(c.job,data,digest);
  Files.delete(meta);Files.deleteIfExists(artifact);return c.job;
 }
 private static void checkClaim(Execution.Recovery r,Claim c)throws IOException{
  if(!"claimed".equals(r.state)||!c.lease.equals(r.proof))throw new IOException("Media lease mismatch");
 }
}
