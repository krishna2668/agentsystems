package dev.worker.test;
import java.net.URI;

/** An external preview link identifies a job, never conveys authority. */
final class PreviewLink {
 static String job(String link,String origin){
  if(link==null)return null;
  try{
   URI u=new URI(link),expected=new URI(origin);
   if(!"https".equals(u.getScheme())||!expected.getRawAuthority().equals(u.getRawAuthority()))return null;
   String path=u.getRawPath(),prefix="/artifacts/";
   if(path==null||!path.startsWith(prefix))return null;
   String id=path.substring(prefix.length());
   if(id.endsWith("/"))id=id.substring(0,id.length()-1);
   return ArtifactLibrary.validId(id)?id:null;
  }catch(Exception e){return null;}
 }
}
