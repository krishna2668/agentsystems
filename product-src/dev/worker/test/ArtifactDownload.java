package dev.worker.test;

import java.io.*;
import java.nio.file.Path;
import java.util.regex.Pattern;

/** Bounded reconstruction of an authorized completed artifact. */
final class ArtifactDownload {
 interface Remote {
  Manifest manifest(String job)throws Exception;
  Chunk chunk(String job,int seq)throws Exception;
 }
 static final class Manifest {
  final String job,digest; final int bytes,chunks;
  Manifest(String job,String digest,int bytes,int chunks){this.job=job;this.digest=digest;this.bytes=bytes;this.chunks=chunks;}
 }
 static final class Chunk {
  final String digest; final int seq,chunks; final byte[] bytes;
  Chunk(String digest,int seq,int chunks,byte[] bytes){this.digest=digest;this.seq=seq;this.chunks=chunks;this.bytes=bytes;}
 }
 static Path fetch(String job,Remote remote,ArtifactLibrary library)throws Exception{
  if(!ArtifactLibrary.validId(job))throw new IOException("Invalid artifact ID");
  Manifest m=remote.manifest(job);
  if(m==null||!job.equals(m.job)||m.digest==null||!Pattern.matches("[0-9a-f]{64}",m.digest)||m.bytes<=0||m.bytes>MediaExecution.MAX_BYTES||m.chunks!=(m.bytes+MediaExecution.CHUNK-1)/MediaExecution.CHUNK)throw new IOException("Invalid manifest");
  ByteArrayOutputStream out=new ByteArrayOutputStream(m.bytes);
  for(int i=0;i<m.chunks;i++){
   Chunk c=remote.chunk(job,i);
   int expected=Math.min(MediaExecution.CHUNK,m.bytes-out.size());
   if(c==null||c.seq!=i||c.chunks!=m.chunks||!m.digest.equals(c.digest)||c.bytes==null||c.bytes.length!=expected)throw new IOException("Invalid artifact chunk");
   out.write(c.bytes);
  }
  if(out.size()!=m.bytes)throw new IOException("Incomplete artifact");
  return library.publish(job,out.toByteArray(),m.digest);
 }
}
