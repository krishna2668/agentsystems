package dev.worker.test;
import java.nio.file.*;
import java.util.*;
public final class ProjectTransportTest {
 static MediaExecution.Claim claim(UUID job,UUID lease,String command)throws Exception{return new MediaExecution.Claim(job+"\t"+lease+"\t"+MediaExecution.CAPABILITY+"\t"+Base64.getEncoder().encodeToString(command.getBytes("UTF-8")));}
 public static void main(String[] args)throws Exception{
  Path dir=Files.createTempDirectory("project-transport");UUID p=UUID.randomUUID(),l=UUID.randomUUID();final int[] renders={0},rejects={0};final boolean[] blocked={false};
  MediaExecution.Remote remote=new MediaExecution.Remote(){
   public Execution.Recovery recover(String j,String l){return new Execution.Recovery(blocked[0]?"blocked":"claimed",j,l);}
   public void chunk(String j,String l,int seq,byte[] b){}
   public String finish(String j,String l,int n,String digest){return digest;}
   public Execution.Recovery rejectProject(String j,String l){rejects[0]++;blocked[0]=true;return new Execution.Recovery("blocked",j,l);}
  };
  MediaExecution m=new MediaExecution(dir,remote,(s,out)->{renders[0]++;Files.write(out.toPath(),new byte[]{(byte)(s.noticeReaction?1:0)});});
  UUID a=UUID.randomUUID(),b=UUID.randomUUID(),c=UUID.randomUUID();
  m.save(claim(a,l,"p1:"+p+":0:2:3:4:5"));if(!a.toString().equals(m.step()))throw new AssertionError("create result");
  m.save(claim(b,l,"p1:"+p+":1:1"));if(!b.toString().equals(m.step()))throw new AssertionError("edit result");
  if(renders[0]!=2||!new PilotProject(dir).read(p,2).spec.noticeReaction||Files.readAllBytes(new ArtifactLibrary(dir).file(b.toString()))[0]!=1||!Files.exists(new ArtifactLibrary(dir).file(a.toString())))throw new AssertionError("revision not rendered");
  m.save(claim(c,l,"p1:"+UUID.randomUUID()+":1:1"));if(!("blocked:"+c).equals(m.step())||m.pending()||rejects[0]!=1||renders[0]!=2)throw new AssertionError("failed revision retained or rendered");
  System.out.println("PASS: project commands render persistent revisions and reject unavailable projects without blocking subsequent work");
 }
}
