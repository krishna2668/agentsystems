package dev.worker.test;

import java.io.*;
import java.nio.file.*;
import java.util.*;
import java.util.regex.Pattern;

/** Private, completed media only. No eviction or public filesystem exposure. */
final class ArtifactLibrary {
 private static final Pattern ID=Pattern.compile("[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}");
 private final Path dir;
 ArtifactLibrary(Path files){dir=files.resolve("library-v1");}
 static boolean validId(String id){return id!=null&&ID.matcher(id).matches();}
 Path file(String job){
  if(!validId(job))throw new IllegalArgumentException("Invalid artifact ID");
  return dir.resolve(job+".mp4");
 }
 List<String> jobs()throws IOException{
  if(!Files.isDirectory(dir))return Collections.emptyList();
  List<String> result=new ArrayList<>();
  try(DirectoryStream<Path> entries=Files.newDirectoryStream(dir,"*.mp4")){
   for(Path p:entries){String name=p.getFileName().toString();String id=name.substring(0,name.length()-4);
    if(validId(id)&&Files.isRegularFile(p)&&Files.size(p)>0&&Files.size(p)<=MediaExecution.MAX_BYTES)result.add(id);
   }
  }
  result.sort((a,b)->Long.compare(file(b).toFile().lastModified(),file(a).toFile().lastModified()));
  return result;
 }
 private static String hash(byte[] data)throws IOException{
  try{return Execution.hash(data);}catch(Exception e){throw new IOException("Artifact digest unavailable",e);}
 }
 synchronized Path publish(String job,byte[] bytes,String digest)throws IOException{
  if(bytes.length==0||bytes.length>MediaExecution.MAX_BYTES||!hash(bytes).equals(digest))throw new IOException("Artifact integrity mismatch");
  Path target=file(job);
  Files.createDirectories(dir);
  if(Files.exists(target)){
   if(Files.size(target)!=bytes.length||!hash(Files.readAllBytes(target)).equals(digest))throw new IOException("Stored artifact mismatch");
   return target;
  }
  Path part=Files.createTempFile(dir,"pending-",".part");
  try{
   try(FileOutputStream out=new FileOutputStream(part.toFile())){out.write(bytes);out.getFD().sync();}
   Files.move(part,target,StandardCopyOption.ATOMIC_MOVE);
   return target;
  }finally{Files.deleteIfExists(part);}
 }
}
