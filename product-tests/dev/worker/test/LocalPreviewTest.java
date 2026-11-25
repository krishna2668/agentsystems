package dev.worker.test;
import java.nio.file.*;
import java.util.*;
public final class LocalPreviewTest {
 public static void main(String[] args)throws Exception{
  Path dir=Files.createTempDirectory("preview-test"),source=dir.resolve("render");
  LocalPreview store=new LocalPreview(dir);if(store.latest()!=null)throw new AssertionError("phantom preview");
  String a=UUID.randomUUID().toString(),b=UUID.randomUUID().toString();
  Files.write(source,new byte[]{1,2});store.publish(a,source);Path first=store.latest();
  if(!Arrays.equals(Files.readAllBytes(first),new byte[]{1,2}))throw new AssertionError("first preview");
  try{store.publish(b,dir.resolve("missing"));throw new AssertionError("missing render");}catch(java.io.IOException expected){}
  if(!first.equals(new LocalPreview(dir).latest()))throw new AssertionError("failed revision replaced preview");
  Files.write(source,new byte[]{3,4});store.publish(b,source);Files.delete(source);
  Path second=new LocalPreview(dir).latest();if(first.equals(second)||!Arrays.equals(Files.readAllBytes(second),new byte[]{3,4})||Files.exists(first))throw new AssertionError("revision retention");
  store.publish(b,source);if(!second.equals(store.latest()))throw new AssertionError("idempotent publication");
  Files.write(dir.resolve("previews-v1/latest"),new byte[]{0});
  Files.write(source,new byte[]{5});store.publish(UUID.randomUUID().toString(),source);
  if(!Arrays.equals(Files.readAllBytes(store.latest()),new byte[]{5}))throw new AssertionError("corrupt reference recovery");
  System.out.println("PASS: atomic preview replacement, failed revision preservation, reopen, idempotency and reference recovery");
 }
}
