import { DatabaseSync, backup } from 'node:sqlite';
import { mkdirSync, cpSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const dataDir=path.resolve(process.env.DATA_DIR||'data');
const destination=path.resolve('backups',new Date().toISOString().replace(/[:.]/g,'-'));
mkdirSync(destination,{recursive:true,mode:0o700});
const db=new DatabaseSync(path.join(dataDir,'smallworld.sqlite'));
// SQLite's backup API captures a consistent snapshot even when WAL is enabled.
await backup(db,path.join(destination,'smallworld.sqlite'));
cpSync(path.join(dataDir,'uploads'),path.join(destination,'uploads'),{recursive:true});
writeFileSync(path.join(destination,'README.txt'),'SMALL WORLD backup. Stop the app before restoring this database and uploads folder to DATA_DIR. Keep this backup private.\n',{mode:0o600});
db.close();console.log('Backup created:',destination);
