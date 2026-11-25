package dev.worker.test;

/** Bounded pilot timeline; no external URLs, arbitrary code or untrusted assets. */
final class AnimaticSpec {
 static final int WIDTH=360,HEIGHT=640,FPS=24;
 final int establish,notice,approach,share;
 final boolean noticeReaction;
 AnimaticSpec(int a,int b,int c,int d){this(a,b,c,d,false);}
 AnimaticSpec(int a,int b,int c,int d,boolean reaction){
  if(a<1||a>10||b<1||b>10||c<1||c>10||d<1||d>10||a+b+c+d>30)
   throw new IllegalArgumentException("Invalid scene duration");
  establish=a;notice=b;approach=c;share=d;noticeReaction=reaction;
 }
 static AnimaticSpec parse(String input){
  if(input==null||!input.matches("v1:[1-9][0-9]?:[1-9][0-9]?:[1-9][0-9]?:[1-9][0-9]?"))
   throw new IllegalArgumentException("Invalid animatic spec");
  String[] v=input.split(":");
  return new AnimaticSpec(Integer.parseInt(v[1]),Integer.parseInt(v[2]),Integer.parseInt(v[3]),Integer.parseInt(v[4]));
 }
 AnimaticSpec withNoticeReaction(boolean enabled){return new AnimaticSpec(establish,notice,approach,share,enabled);}
 String timing(){return "v1:"+establish+":"+notice+":"+approach+":"+share;}
 double gaze(int frame){
  if(!noticeReaction)return 1;
  double p=Math.max(0,Math.min(1,(frame/(double)FPS-establish)/Math.min(0.65,notice)));
  return p*p*(3-2*p);
 }
 int frames(){return (establish+notice+approach+share)*FPS;}
 double progress(int frame){
  double p=Math.max(0,Math.min(1,(frame/(double)FPS-establish-notice)/approach));
  return p*p*(3-2*p);
 }
}
