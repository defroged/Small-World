import { createInterface } from 'node:readline/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { openDatabase } from '../src/db.js';
import { hashPassword } from '../src/security.js';

const input=createInterface({input:process.stdin,output:process.stdout});
try {
  console.log('SMALL WORLD — 管理者アカウントの作成・パスワード再設定');
  const email=(await input.question('メールアドレス: ')).trim().toLowerCase();
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw new Error('メールアドレスをご確認ください。');
  const name=(await input.question('表示名: ')).trim()||'SMALL WORLD';
  input.close();
  if(!process.stdin.isTTY)throw new Error('パスワードは対話型ターミナルで入力してください。');
  async function passwordPrompt(label){
    process.stdout.write(label);process.stdin.setRawMode(true);process.stdin.resume();process.stdin.setEncoding('utf8');
    return new Promise((resolve,reject)=>{
      let value='';
      const finish=()=>{process.stdin.off('data',onData);process.stdin.setRawMode(false);process.stdin.pause();process.stdout.write('\n');};
      function onData(chunk){for(const char of chunk){
        if(char==='\u0003'){finish();reject(new Error('キャンセルしました。'));return;}
        if(char==='\r'||char==='\n'){finish();resolve(value);return;}
        if(char==='\u007f'||char==='\b')value=value.slice(0,-1);
        else if(char>=' ')value+=char;
      }}
      process.stdin.on('data',onData);
    });
  }
  const password=await passwordPrompt('パスワード（12文字以上・画面には表示されません）: ');
  const confirmation=await passwordPrompt('もう一度入力: ');
  if(password!==confirmation)throw new Error('パスワードが一致しません。');
  const digest=await hashPassword(password);
  const db=openDatabase(path.resolve(process.env.DATA_DIR||'data'));
  const existing=db.prepare('SELECT id,role FROM users WHERE email=?').get(email);
  if(existing&&existing.role!=='admin')throw new Error('保護者として登録済みです。別のメールアドレスを使ってください。');
  if(existing){db.prepare('UPDATE users SET name=?,password_hash=?,active=1 WHERE id=?').run(name,digest,existing.id);db.prepare('DELETE FROM sessions WHERE user_id=?').run(existing.id);}
  else db.prepare('INSERT INTO users VALUES (?,?,?,?,\'admin\',1,?)').run(randomUUID(),email,name,digest,new Date().toISOString());
  db.close();console.log('管理者アカウントを保存しました。/admin からログインできます。');
}catch(error){console.error(error.message);process.exitCode=1;}finally{input.close();}
