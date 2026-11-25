package dev.worker.test;

import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;

/** Independently sync bounded visual evidence from a retained completed MP4.
 * A failed upload never changes the completed video or its project revision.
 */
final class ReviewSync {
 static final int MAX_JPEG=196608;
 interface Capture {byte[] jpeg(Path video)throws Exception;}
 interface Remote {void upload(String job,String sourceHash,String jpegHash,byte[] jpeg)throws Exception;}
 private final ArtifactLibrary library;
 private final Path acknowledgements,pending;
 private final Capture capture;
 private final Remote remote;
 ReviewSync(Path files,Capture capture,Remote remote){
  this.library=new ArtifactLibrary(files);this.acknowledgements=files.resolve("review-ack-v1");pending=files.resolve("review-pending-v1");
  this.capture=capture;this.remote=remote;
 }
 String step()throws Exception{
  for(String job:library.jobs()){
   Path movie=library.file(job),ack=acknowledgements.resolve(job+".sha256");
   if(Files.isRegularFile(ack)){
    if(Files.size(ack)>160)throw new IOException("Invalid review acknowledgement");
    String saved=new String(Files.readAllBytes(ack),StandardCharsets.UTF_8);
    if(!saved.matches("[a-f0-9]{64} [a-f0-9]{64}"))throw new IOException("Invalid review acknowledgement");
    // ArtifactLibrary is append-only. Avoid rehashing every acknowledged MP4
    // during each idle Worker poll; the source hash was checked on upload.
    continue;
   }
   String source=Execution.hash(Files.readAllBytes(movie));
   Path waiting=pending.resolve(job+".jpg");
   byte[] jpeg;
   if(Files.isRegularFile(waiting)){
    if(Files.size(waiting)>MAX_JPEG)throw new IOException("Oversized pending review");
    jpeg=Files.readAllBytes(waiting);
   }else{
    jpeg=capture.jpeg(movie);
    if(jpeg==null||jpeg.length<100||jpeg.length>MAX_JPEG)throw new IOException("Invalid captured review size");
    Files.createDirectories(pending);
    Path fresh=Files.createTempFile(pending,"capture-",".tmp");
    try{
     try(FileOutputStream out=new FileOutputStream(fresh.toFile())){out.write(jpeg);out.getFD().sync();}
     Files.move(fresh,waiting,StandardCopyOption.ATOMIC_MOVE);
    }finally{Files.deleteIfExists(fresh);}
   }
   if(jpeg==null||jpeg.length<100||jpeg.length>MAX_JPEG||((jpeg[0]&255)!=255)||((jpeg[1]&255)!=216)||((jpeg[2]&255)!=255)||((jpeg[jpeg.length-2]&255)!=255)||((jpeg[jpeg.length-1]&255)!=217))throw new IOException("Invalid review JPEG");
   String hash=Execution.hash(jpeg);
   remote.upload(job,source,hash,jpeg);
   Files.createDirectories(acknowledgements);
   Path temp=Files.createTempFile(acknowledgements,"pending-",".tmp");
   try{
    try(FileOutputStream out=new FileOutputStream(temp.toFile())){out.write((source+" "+hash).getBytes(StandardCharsets.UTF_8));out.getFD().sync();}
    Files.move(temp,ack,StandardCopyOption.ATOMIC_MOVE,StandardCopyOption.REPLACE_EXISTING);
   }finally{Files.deleteIfExists(temp);}
   Files.deleteIfExists(waiting);
   return job;
  }
  return null;
 }
}
