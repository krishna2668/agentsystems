package dev.worker.test;
import java.io.IOException;
import java.nio.file.*;
import java.util.UUID;
public final class PilotProjectTest {
 public static void main(String[] args)throws Exception{
  Path dir=Files.createTempDirectory("pilot-project-test");UUID project=UUID.randomUUID(),create=UUID.randomUUID(),edit=UUID.randomUUID();
  PilotProject store=new PilotProject(dir);
  PilotProject.Snapshot first=store.create(project,create,AnimaticSpec.parse("v1:2:3:4:5"));
  if(first.revision!=1||first.spec.noticeReaction||first.spec.frames()!=336)throw new AssertionError("create");
  store=new PilotProject(dir);PilotProject.Snapshot second=store.setNoticeReaction(project,1,edit,true);
  if(second.revision!=2||!second.spec.noticeReaction||second.spec.frames()!=first.spec.frames()||!second.spec.timing().equals(first.spec.timing()))throw new AssertionError("targeted edit");
  if(second.spec.gaze(0)!=0||second.spec.gaze(48)!=0||second.spec.gaze(54)<=0||second.spec.gaze(64)!=1||second.spec.progress(120)!=0)throw new AssertionError("reaction must precede approach");
  if(store.read(project,1).spec.noticeReaction||!store.read(project,2).spec.noticeReaction)throw new AssertionError("immutable history");
  if(!store.setNoticeReaction(project,1,edit,true).encode().equals(second.encode()))throw new AssertionError("retry");
  try{store.setNoticeReaction(project,1,UUID.randomUUID(),false);throw new AssertionError("stale overwrite");}catch(IOException expected){}
  try{store.setNoticeReaction(project,1,edit,false);throw new AssertionError("changed replay");}catch(IOException expected){}
  try{store.setNoticeReaction(UUID.randomUUID(),1,edit,true);throw new AssertionError("unknown project");}catch(IOException expected){}
  if(!store.create(project,create,first.spec).encode().equals(first.encode()))throw new AssertionError("create retry");
  PilotProject.Snapshot third=store.setNoticeReaction(project,2,UUID.randomUUID(),false);
  if(third.revision!=3||third.spec.noticeReaction||!store.read(project,2).spec.noticeReaction)throw new AssertionError("restore as revision");
  System.out.println("PASS: persistent project identity, immutable revisions, targeted notice edit, stale conflict and exact replay");
 }
}
