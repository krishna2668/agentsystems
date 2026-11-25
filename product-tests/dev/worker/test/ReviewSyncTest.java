package dev.worker.test;
import java.io.*;
import java.nio.file.*;
import java.util.*;

public final class ReviewSyncTest {
 public static void main(String[] args)throws Exception{
  Path root=Files.createTempDirectory("review-sync");
  String job=UUID.randomUUID().toString();byte[] video="retained original media".getBytes("UTF-8");
  ArtifactLibrary lib=new ArtifactLibrary(root);lib.publish(job,video,Execution.hash(video));
  byte[] jpeg=new byte[105];jpeg[0]=(byte)255;jpeg[1]=(byte)216;jpeg[2]=(byte)255;jpeg[103]=(byte)255;jpeg[104]=(byte)217;
  int[] captures={0},uploads={0};boolean[] lost={true};
  ReviewSync s=new ReviewSync(root,p->{captures[0]++;return jpeg;},(j,source,digest,data)->{
    if(!j.equals(job)||!source.equals(Execution.hash(video))||!digest.equals(Execution.hash(jpeg)))throw new AssertionError();
    uploads[0]++;if(lost[0]){lost[0]=false;throw new IOException("confirmation lost");}
  });
  try{s.step();throw new AssertionError("unexpected confirmation");}catch(IOException ok){}
  if(Files.exists(root.resolve("review-ack-v1").resolve(job+".sha256")))throw new AssertionError("premature acknowledgement");
  if(!job.equals(s.step())||s.step()!=null||captures[0]!=1||uploads[0]!=2)throw new AssertionError("durable replay or duplicate review");
  if(!Arrays.equals(Files.readAllBytes(lib.file(job)),video))throw new AssertionError("media altered");
  if(new ReviewSync(root,p->{throw new AssertionError("rerender");},(j,src,h,bytes)->{throw new AssertionError("duplicate upload");}).step()!=null)throw new AssertionError();
  System.out.println("PASS: signed review payload, lost confirmation retry, persisted acknowledgement, and immutable media");
 }
}
