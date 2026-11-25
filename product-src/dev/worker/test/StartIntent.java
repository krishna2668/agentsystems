package dev.worker.test;

/** One explicit start request; never starts in the background or without a user action. */
final class StartIntent {
 private static final int IDLE=0, WAIT_PERMISSION=1, READY=2;
 private int state=IDLE;
 boolean requestPermission(){if(state!=IDLE)return false;state=WAIT_PERMISSION;return true;}
 boolean permissionResult(boolean granted){if(state!=WAIT_PERMISSION)return false;state=granted?READY:IDLE;return true;}
 void requestStart(){state=READY;}
 void cancel(){state=IDLE;}
 int state(){return state;}
 void restore(int saved){state=saved==WAIT_PERMISSION||saved==READY?saved:IDLE;}
 boolean consume(boolean foreground,boolean paired,boolean active){
  if(!paired||active){cancel();return false;}
  if(state!=READY||!foreground)return false;
  cancel();return true;
 }
}
