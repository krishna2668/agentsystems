package dev.worker.test;
public final class StartIntentTest {
 private static void check(boolean value){if(!value)throw new AssertionError();}
 public static void main(String[] args){
  StartIntent s=new StartIntent();
  check(!s.consume(true,true,false));check(s.requestPermission());check(!s.requestPermission());
  check(!s.consume(true,true,false));check(s.permissionResult(true));check(!s.consume(false,true,false));
  check(s.consume(true,true,false));check(!s.consume(true,true,false));
  check(s.requestPermission());check(s.permissionResult(false));check(!s.consume(true,true,false));
  check(s.requestPermission());StartIntent restored=new StartIntent();restored.restore(s.state());
  check(restored.permissionResult(true));check(restored.consume(true,true,false));
  check(!restored.consume(true,true,false));check(!restored.permissionResult(true));
  s=new StartIntent();s.requestStart();check(!s.consume(true,false,false));check(!s.consume(true,true,false));
  s.requestStart();check(!s.consume(true,true,true));check(!s.consume(true,true,false));
  s.requestStart();s.cancel();check(!s.consume(true,true,false));
  System.out.println("PASS: permission grant, denial, background, rotation, duplicate start, revocation, cancellation");
 }
}
