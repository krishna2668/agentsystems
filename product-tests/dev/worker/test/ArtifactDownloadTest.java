package dev.worker.test;
import java.nio.file.*;
import java.util.*;
public final class ArtifactDownloadTest {
 public static void main(String[] args)throws Exception{
  String job=UUID.randomUUID().toString();
  byte[] data=new byte[65539];new Random(15).nextBytes(data);
  String digest=Execution.hash(data);
  ArtifactLibrary lib=new ArtifactLibrary(Files.createTempDirectory("download-test"));
  final int[] failure={1};
  ArtifactDownload.Remote remote=new ArtifactDownload.Remote(){
   public ArtifactDownload.Manifest manifest(String id){return new ArtifactDownload.Manifest(id,digest,data.length,2);}
   public ArtifactDownload.Chunk chunk(String id,int seq)throws Exception{
    if(seq==1&&failure[0]==1)throw new java.io.IOException("Interrupted");
    byte[] bytes=Arrays.copyOfRange(data,seq*65536,Math.min(data.length,(seq+1)*65536));
    if(seq==1&&failure[0]==2)bytes[0]^=1;
    return new ArtifactDownload.Chunk(digest,seq,2,bytes);
   }
  };
  for(int mode:new int[]{1,2}){
   failure[0]=mode;
   try{ArtifactDownload.fetch(job,remote,lib);throw new AssertionError("bad result published");}catch(java.io.IOException expected){}
   if(!lib.jobs().isEmpty())throw new AssertionError("partial result");
  }
  failure[0]=0;
  if(!Arrays.equals(data,Files.readAllBytes(ArtifactDownload.fetch(job,remote,lib))))throw new AssertionError("wrong result");
  System.out.println("PASS: interrupted and corrupt download, verified retry and atomic publication");
 }
}
