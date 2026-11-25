package dev.worker.test;

import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.UUID;

/** Latest complete local render. Independent of upload acknowledgement. */
final class LocalPreview {
 private final Path dir, pointer;
 LocalPreview(Path files){dir=files.resolve("previews-v1");pointer=dir.resolve("latest");}
 private static String checked(String job){return UUID.fromString(job).toString();}
 Path latest()throws IOException{
  if(!Files.exists(pointer))return null;
  if(Files.size(pointer)!=36)throw new IOException("Invalid preview reference");
  try{Path p=dir.resolve(checked(new String(Files.readAllBytes(pointer),StandardCharsets.UTF_8))+".mp4");return Files.isRegularFile(p)?p:null;}
  catch(IllegalArgumentException e){throw new IOException("Invalid preview reference",e);}
 }
 void publish(String job,Path source)throws IOException{
  Files.createDirectories(dir);String id=checked(job);Path dest=dir.resolve(id+".mp4");
  Path current;try{current=latest();}catch(IOException e){current=null;}
  if(dest.equals(current)&&Files.isRegularFile(dest))return;
  Path part=dir.resolve("render.tmp");
  Files.copy(source,part,StandardCopyOption.REPLACE_EXISTING);
  try(RandomAccessFile f=new RandomAccessFile(part.toFile(),"rw")){f.getFD().sync();}
  Files.move(part,dest,StandardCopyOption.REPLACE_EXISTING,StandardCopyOption.ATOMIC_MOVE);
  Path next=dir.resolve("latest.tmp");
  try(FileOutputStream f=new FileOutputStream(next.toFile())){f.write(id.getBytes(StandardCharsets.UTF_8));f.getFD().sync();}
  Files.move(next,pointer,StandardCopyOption.REPLACE_EXISTING,StandardCopyOption.ATOMIC_MOVE);
  // The published preview survives even if cleanup fails. The current render is never removed.
  try(DirectoryStream<Path> entries=Files.newDirectoryStream(dir,"*.mp4")){
   for(Path p:entries)if(!dest.equals(p))try{Files.deleteIfExists(p);}catch(IOException ignored){}
  }catch(IOException ignored){}
 }
}
