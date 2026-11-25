package dev.worker.test;
public final class AnimaticSpecTest {
 public static void main(String[] args){
  AnimaticSpec s=AnimaticSpec.parse("v1:4:4:5:7");
  if(s.frames()!=480||s.progress(0)!=0||s.progress(192)!=0||s.progress(312)!=1||s.progress(252)!=.5)throw new AssertionError("timeline");
  for(String v:new String[]{"v2:4:4:5:7","v1:0:4:5:7","v1:11:4:5:7","v1:10:10:10:10","v1:4:4:5:7:1","v1:4:4:5:7\n","v1:04:4:5:7","v1:-4:4:5:7"}){try{AnimaticSpec.parse(v);throw new AssertionError(v);}catch(IllegalArgumentException expected){}}
  System.out.println("PASS: bounded animatic timeline and invalid input rejection");
 }
}
