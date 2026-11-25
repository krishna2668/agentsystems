package dev.worker.test;
public final class PreviewLinkTest {
 public static void main(String[] args){
  String origin="https://example.invalid",id="12345678-1234-1234-1234-123456789abc",path="/artifacts/"+id;
  if(!id.equals(PreviewLink.job(origin+path,origin)))throw new AssertionError("valid link");
  for(String suffix:new String[]{"?utm_source=chatgpt.com","?token=x","#x","/","/?utm_source=chatgpt.com#x"})
   if(!id.equals(PreviewLink.job(origin+path+suffix,origin)))throw new AssertionError("decorated link rejected");
  for(String bad:new String[]{null,"http://example.invalid"+path,"https://evil.invalid"+path,origin+"/artifacts/../x",origin+path+"/extra","https://example.invalid@evil.invalid"+path,origin+"/artifacts/%31"+id.substring(1)})
   if(PreviewLink.job(bad,origin)!=null)throw new AssertionError("accepted invalid link: "+bad);
  System.out.println("PASS: exact HTTPS origin, artifact route and safe identifier");
 }
}
