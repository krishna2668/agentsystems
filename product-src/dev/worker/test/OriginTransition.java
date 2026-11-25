package dev.worker.test;

/** Only a release-configured previous origin is eligible for a verified transition. */
final class OriginTransition {
 static boolean allowed(String saved,String previous,String target){
  return previous.startsWith("https://")&&target.startsWith("https://")&&!previous.equals(target)&&previous.equals(saved);
 }
 static boolean verified(String id,String target,String challenge,String status,String returnedId,String returnedOrigin,String returnedChallenge){
  return !id.isEmpty()&&!challenge.isEmpty()&&"verified".equals(status)&&id.equals(returnedId)&&target.equals(returnedOrigin)&&challenge.equals(returnedChallenge);
 }
}
