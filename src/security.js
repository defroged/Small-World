import { randomBytes, createHash, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import sanitizeHtml from 'sanitize-html';

const scrypt = promisify(scryptCallback);
export const token = () => randomBytes(32).toString('hex');
export const hash = value => createHash('sha256').update(value).digest('hex');
export const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export async function hashPassword(password) {
  if (typeof password !== 'string' || password.length < 12 || password.length > 256) throw new Error('パスワードは12〜256文字で入力してください。');
  const salt = randomBytes(16).toString('hex');
  const digest = await scrypt(password, salt, 64);
  return `scrypt:${salt}:${digest.toString('hex')}`;
}
export async function verifyPassword(password, stored) {
  if (typeof password !== 'string' || password.length > 256) return false;
  const [,salt,digest] = (stored || 'scrypt:00000000000000000000000000000000:'+'0'.repeat(128)).split(':');
  const actual = await scrypt(password, salt, 64);
  const expected = Buffer.from(digest, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual,expected) && !!stored;
}
export function localMedia(value) {
  if (typeof value !== 'string') return '';
  if (/^\/(assets|uploads)\/[a-zA-Z0-9_.~%-]+$/.test(value)) return value;
  try {
    const url=new URL(value);
    if (url.protocol!=='https:' || url.username || url.password || url.hash) return '';
    const wixImage=url.hostname==='static.wixstatic.com' && /^\/media\/[a-zA-Z0-9_.~%-]+(?:\/v1\/[a-zA-Z0-9_.,~%/-]+)?$/.test(url.pathname);
    const wixVideo=url.hostname==='video.wixstatic.com' && /^\/video\/[a-zA-Z0-9_.~-]+\/(?:\d+p\/mp4\/)?file\.mp4$/.test(url.pathname);
    return wixImage || wixVideo ? value : '';
  } catch { return ''; }
}
export function cleanBody(body) {
  return sanitizeHtml(String(body || ''), {
    allowedTags: ['p','div','br','h2','h3','h4','strong','b','em','i','s','u','ul','ol','li','blockquote','a','img','audio','video','source','hr','code','pre'],
    allowedAttributes: { a:['href','rel'], img:['src','alt','loading'], audio:['src','controls','preload'], video:['src','controls','preload'], source:['src','type'] },
    allowedSchemes:['http','https','mailto','tel'],
    allowProtocolRelative:false,
    transformTags: {
      a:(tagName,attrs)=>({tagName,attribs:{href:attrs.href||'',rel:'noopener noreferrer'}}),
      img:(tagName,attrs)=>({tagName,attribs:{src:localMedia(attrs.src),alt:attrs.alt||'',loading:'lazy'}}),
      audio:(tagName,attrs)=>({tagName,attribs:{src:localMedia(attrs.src),controls:'',preload:'metadata'}}),
      video:(tagName,attrs)=>({tagName,attribs:{src:localMedia(attrs.src),controls:'',preload:'metadata'}}),
      source:(tagName,attrs)=>({tagName,attribs:{src:localMedia(attrs.src)}})
    }
  });
}
export function textOnly(html) { return sanitizeHtml(html,{allowedTags:[],allowedAttributes:{}}); }
export function detectMedia(buffer) {
  if (buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return ['image/png','.png'];
  if (buffer[0]===255 && buffer[1]===216 && buffer[2]===255) return ['image/jpeg','.jpg'];
  if (/^GIF8[79]a$/.test(buffer.subarray(0,6).toString())) return ['image/gif','.gif'];
  if (buffer.subarray(0,4).toString()==='RIFF' && buffer.subarray(8,12).toString()==='WEBP') return ['image/webp','.webp'];
  if (buffer.subarray(0,4).toString()==='RIFF' && buffer.subarray(8,12).toString()==='WAVE') return ['audio/wav','.wav'];
  if (buffer.subarray(0,3).toString()==='ID3' || (buffer[0]===255 && (buffer[1]&0xe0)===0xe0)) return ['audio/mpeg','.mp3'];
  if (buffer.subarray(0,4).toString()==='OggS') return ['audio/ogg','.ogg'];
  if (buffer.subarray(4,8).toString()==='ftyp') {
    const brand=buffer.subarray(8,12).toString();
    if (['M4A ','M4B '].includes(brand)) return ['audio/mp4','.m4a'];
    if (['isom','iso2','mp41','mp42','avc1','M4V '].includes(brand)) return ['video/mp4','.mp4'];
  }
  return null;
}
