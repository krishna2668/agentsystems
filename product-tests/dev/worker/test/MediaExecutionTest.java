package dev.worker.test;
import java.io.*;
import java.nio.file.*;
import java.util.*;
public final class MediaExecutionTest {
 public static void main(String[] a)throws Exception{
  Path dir=Files.createTempDirectory("media-execution-test");
  String job=UUID.randomUUID().toString(),lease=UUID.randomUUID().toString(),input=Base64.getEncoder().encodeToString("v1:4:4:5:7".getBytes("UTF-8"));
  byte[] bytes=new byte[70000];new Random(12).nextBytes(bytes);String expected=Execution.hash(bytes);
  final int[] renders={0},writes={0};final boolean[] complete={false},fail={true};
  MediaExecution.Remote remote=new MediaExecution.Remote(){
   public Execution.Recovery recover(String j,String l){return new Execution.Recovery(complete[0]?"completed":"claimed",j,complete[0]?expected:l);}
   public void chunk(String j,String l,int seq,byte[] data)throws Exception{writes[0]++;if(seq==1&&fail[0]){fail[0]=false;throw new IOException("network interrupted");}}
   public String finish(String j,String l,int count,String digest)throws Exception{if(count!=2||!expected.equals(digest))throw new AssertionError();complete[0]=true;throw new IOException("confirmation lost");}
  };
  MediaExecution.Render render=(spec,out)->{renders[0]++;Files.write(out.toPath(),bytes);};
  MediaExecution m=new MediaExecution(dir,remote,render);m.save(new MediaExecution.Claim(job+"\t"+lease+"\t"+MediaExecution.CAPABILITY+"\t"+input));
  try{m.step();throw new AssertionError();}catch(IOException e){if(!e.getMessage().equals("network interrupted"))throw e;}
  if(!m.pending()||renders[0]!=1)throw new AssertionError("checkpoint lost");
  Path preview=new LocalPreview(dir).latest();if(preview==null||!Arrays.equals(Files.readAllBytes(preview),bytes))throw new AssertionError("offline preview lost");
  m=new MediaExecution(dir,remote,render);
  try{m.step();throw new AssertionError();}catch(IOException e){if(!e.getMessage().equals("confirmation lost"))throw e;}
  if(!m.pending()||renders[0]!=1||!complete[0])throw new AssertionError("rerender or missing artifact");
  m=new MediaExecution(dir,remote,render);
  if(!job.equals(m.step())||m.pending()||renders[0]!=1||writes[0]!=4)throw new AssertionError("recovery");
  if(!preview.equals(new LocalPreview(dir).latest())||!Arrays.equals(Files.readAllBytes(preview),bytes))throw new AssertionError("completed preview lost");
  System.out.println("PASS: interrupted chunk, lost completion, restart, single render and retained preview");
 }
}
