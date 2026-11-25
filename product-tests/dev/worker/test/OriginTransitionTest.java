package dev.worker.test;
public final class OriginTransitionTest {
 private static void check(boolean result){if(!result)throw new AssertionError();}
 public static void main(String[] args){
  String old="https://old.example",target="https://new.example";
  check(OriginTransition.allowed(old,old,target));
  check(!OriginTransition.allowed("https://unknown.example",old,target));
  check(!OriginTransition.allowed(old,old,old));
  check(!OriginTransition.allowed("http://old.example","http://old.example",target));
  check(OriginTransition.verified("id",target,"challenge","verified","id",target,"challenge"));
  check(!OriginTransition.verified("id",target,"challenge","verified","other",target,"challenge"));
  check(!OriginTransition.verified("id",target,"challenge","verified","id",old,"challenge"));
  check(!OriginTransition.verified("id",target,"challenge","verified","id",target,"other"));
  check(!OriginTransition.verified("id",target,"challenge","failed","id",target,"challenge"));
  System.out.println("PASS: explicit configured origins and exact signed challenge response");
 }
}
