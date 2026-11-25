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
  default Execution.Recovery rejectProject(String job,String lease)throws Exception{throw new IOException("Project rejection unavailable");}
 }
 interface Render {void render(AnimaticSpec s,File out)throws Exception;}
 static final class Claim {
  final String job,lease,capability,payload;
  Claim(String raw)throws IOException{
   String[] v=raw.split("\t",-1);
   if(v.length!=4||!v[0].matches("[a-f0-9-]{36}")||!v[1].matches("[a-f0-9-]{36}")||!(CAPABILITY.equals(v[2])||"file.sha256".equals(v[2])))throw new IOException("Invalid claim");
   job=v[0];lease=v[1];capability=v[2];payload=v[3];
   if(CAPABILITY.equals(capability))validate();
  }
  String command()throws IOException{
   try{if(payload.length()>160)throw new IllegalArgumentException();return new String(Base64.getDecoder().decode(payload),StandardCharsets.UTF_8);}catch(IllegalArgumentException e){throw new IOException("Invalid media spec",e);}
  }
  boolean project()throws IOException{return command().startsWith("p1:");}
  private void validate()throws IOException{
   try{String v=command();if(!project()){AnimaticSpec.parse(v);return;}String[] f=v.split(":",-1);
    if(f.length<4||!java.util.UUID.fromString(f[1]).toString().equals(f[1])||!f[2].matches("0|[1-9]|1[0-5]"))throw new IllegalArgumentException();
    if("0".equals(f[2])){if(f.length!=7)throw new IllegalArgumentException();AnimaticSpec.parse("v1:"+String.join(":",java.util.Arrays.copyOfRange(f,3,7)));}
    else if(f.length!=4||!("0".equals(f[3])||"1".equals(f[3])))throw new IllegalArgumentException();
   }catch(IllegalArgumentException e){throw new IOException("Invalid media spec",e);}
  }
  AnimaticSpec spec(PilotProject projects)throws IOException{
   String v=command();if(!project())return AnimaticSpec.parse(v);
   String[] f=v.split(":");java.util.UUID id=java.util.UUID.fromString(f[1]),operation=java.util.UUID.fromString(job);int base=Integer.parseInt(f[2]);
   return (base==0?projects.create(id,operation,AnimaticSpec.parse("v1:"+String.join(":",java.util.Arrays.copyOfRange(f,3,7)))):projects.setNoticeReaction(id,base,operation,"1".equals(f[3]))).spec;
  }
  String raw(){return String.join("\t",job,lease,capability,payload);}
  String legacy(){return String.join("\t",job,lease,payload);}
 }
 private final Path meta,artifact,part;
 private final Remote remote;private final Render renderer;private final LocalPreview preview;private final PilotProject projects;
 MediaExecution(Path dir,Remote remote,Render renderer){
  meta=dir.resolve("media-checkpoint-v1");artifact=dir.resolve("media-artifact-v1.mp4");part=dir.resolve("media-artifact-v1.part.mp4");this.remote=remote;this.renderer=renderer;preview=new LocalPreview(dir);projects=new PilotProject(dir);
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
  if(c.project()&&"blocked".equals(r.state))return clearBlocked(c,r);
  if(!Files.exists(artifact)){
   if("completed".equals(r.state))throw new IOException("Completed media checkpoint missing artifact");
   checkClaim(r,c);Files.deleteIfExists(part);
   AnimaticSpec spec;try{spec=c.spec(projects);}catch(PilotProject.Unavailable e){return clearBlocked(c,remote.rejectProject(c.job,c.lease));}
   renderer.render(spec,part.toFile());
   if(Files.size(part)==0||Files.size(part)>MAX_BYTES)throw new IOException("Invalid media artifact size");
   try(RandomAccessFile file=new RandomAccessFile(part.toFile(),"rw")){file.getFD().sync();}
   Files.move(part,artifact,StandardCopyOption.ATOMIC_MOVE);
  }
  long size=Files.size(artifact);if(size<=0||size>MAX_BYTES)throw new IOException("Invalid media artifact size");
  byte[] data=Files.readAllBytes(artifact);String digest=Execution.hash(data);
  preview.publish(c.job,artifact);
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
  Files.delete(meta);Files.deleteIfExists(artifact);return c.job;
 }
 private String clearBlocked(Claim c,Execution.Recovery r)throws IOException{
  if(!"blocked".equals(r.state)||!c.job.equals(r.job)||!c.lease.equals(r.proof))throw new IOException("Project rejection unconfirmed");
  Files.deleteIfExists(part);Files.deleteIfExists(artifact);Files.delete(meta);return "blocked:"+c.job;
 }
 private static void checkClaim(Execution.Recovery r,Claim c)throws IOException{
  if(!"claimed".equals(r.state)||!c.lease.equals(r.proof))throw new IOException("Media lease mismatch");
 }
}
