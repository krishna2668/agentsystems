import qrcode from 'qrcode-generator';

const field=document.getElementById('preview-url');
const canvas=document.getElementById('preview-qr');
const copy=document.getElementById('copy-link');
const status=document.getElementById('copy-status');
const url=field.value;
// Generate the QR entirely on this device. No third-party request, account,
// token, analytics, or artifact data is needed.
try {
 const qr=qrcode(0,'M');
 qr.addData(url,'Byte'); qr.make();
 const n=qr.getModuleCount(), quiet=4, scale=5;
 canvas.width=canvas.height=(n+2*quiet)*scale;
 const ctx=canvas.getContext('2d');
 ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);
 ctx.fillStyle='#000';
 for(let row=0;row<n;row++)for(let col=0;col<n;col++)
  if(qr.isDark(row,col))ctx.fillRect((col+quiet)*scale,(row+quiet)*scale,scale,scale);
 canvas.hidden=false;
 document.getElementById('scan-help').hidden=false;
}catch {
 // The visible link remains usable if QR generation fails.
}
copy.hidden=false;
copy.addEventListener('click',async()=>{
 try{
  await navigator.clipboard.writeText(url);
  status.textContent='Link copied.';
 }catch{
  field.focus();field.select();
  status.textContent='Select and copy the link.';
 }
});
