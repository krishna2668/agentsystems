package dev.worker.test;

import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.UUID;

/** One bounded, editable pilot project. The Worker serializes all mutations. */
final class PilotProject {
 static final class Unavailable extends IOException {Unavailable(String message){super(message);}}
 static final class Snapshot {
  final UUID id, operation;
  final int revision;
  final AnimaticSpec spec;
  Snapshot(UUID id,int revision,UUID operation,AnimaticSpec spec){this.id=id;this.revision=revision;this.operation=operation;this.spec=spec;}
  String encode(){return "pilot1\n"+id+"\n"+revision+"\n"+operation+"\n"+spec.timing()+"\n"+(spec.noticeReaction?"1":"0");}
 }
 private final Path root;
 PilotProject(Path files){root=files.resolve("pilot-projects-v1");}
 private Path path(UUID id,int revision){if(id==null||revision<1)throw new IllegalArgumentException("Invalid project revision");return root.resolve(id.toString()).resolve(revision+".snapshot");}
 Snapshot read(UUID id,int revision)throws IOException{
  Path p=path(id,revision);if(!Files.isRegularFile(p))throw new Unavailable("Project revision unavailable");
  if(Files.size(p)>512)throw new IOException("Invalid project snapshot");
  try{
   String[] v=new String(Files.readAllBytes(p),StandardCharsets.UTF_8).split("\n",-1);
   if(v.length!=6||!"pilot1".equals(v[0])||!id.toString().equals(v[1])||!Integer.toString(revision).equals(v[2])||!("0".equals(v[5])||"1".equals(v[5])))throw new IllegalArgumentException();
   return new Snapshot(id,revision,UUID.fromString(v[3]),AnimaticSpec.parse(v[4]).withNoticeReaction("1".equals(v[5])));
  }catch(IllegalArgumentException e){throw new IOException("Invalid project snapshot",e);}
 }
 private Snapshot write(Snapshot s)throws IOException{
  Path p=path(s.id,s.revision);Files.createDirectories(p.getParent());
  Path tmp=p.resolveSibling(p.getFileName()+".tmp");
  try(FileOutputStream f=new FileOutputStream(tmp.toFile())){f.write(s.encode().getBytes(StandardCharsets.UTF_8));f.getFD().sync();}
  Files.move(tmp,p,StandardCopyOption.ATOMIC_MOVE);return s;
 }
 private Snapshot replay(Snapshot wanted)throws IOException{
  Snapshot saved=read(wanted.id,wanted.revision);
  if(!saved.encode().equals(wanted.encode()))throw new Unavailable("Project revision conflict");return saved;
 }
 Snapshot create(UUID id,UUID operation,AnimaticSpec spec)throws IOException{
  if(operation==null||spec==null)throw new IllegalArgumentException("Invalid project creation");
  Snapshot wanted=new Snapshot(id,1,operation,spec);
  return Files.exists(path(id,1))?replay(wanted):write(wanted);
 }
 Snapshot setNoticeReaction(UUID id,int expectedRevision,UUID operation,boolean enabled)throws IOException{
  if(operation==null||expectedRevision<1||expectedRevision==Integer.MAX_VALUE)throw new IllegalArgumentException("Invalid project edit");
  Snapshot before=read(id,expectedRevision);
  // An edit names its base revision; replay returns exactly the original result.
  Snapshot wanted=new Snapshot(id,expectedRevision+1,operation,before.spec.withNoticeReaction(enabled));
  return Files.exists(path(id,wanted.revision))?replay(wanted):write(wanted);
 }
}
