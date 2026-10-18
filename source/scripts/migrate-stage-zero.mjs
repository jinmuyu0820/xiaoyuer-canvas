import { createClient } from '@libsql/client';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const dataRoot=resolve(process.env.BEATDESIGN_DATA_DIR||'data');
const client=createClient({url:`file:${resolve(dataRoot,'local.db')}`});
try {
  const tables=(await client.execute("SELECT name FROM sqlite_master WHERE type='table'")).rows.map(r=>r.name);
  if(tables.includes('project_timeline_state')) {
    const rows=(await client.execute('SELECT * FROM project_timeline_state')).rows;
    const receipts=tables.includes('project_command_receipt')?(await client.execute("SELECT * FROM project_command_receipt WHERE command_type LIKE 'editor.%'")).rows:[];
    await mkdir(resolve(dataRoot,'retired'),{recursive:true});
    await writeFile(resolve(dataRoot,'retired',`editor-${Date.now()}.json`),JSON.stringify({timelines:rows,receipts},(_k,v)=>typeof v==='bigint'?String(v):v,2),{flag:'wx'});
    await client.execute('DROP TABLE project_timeline_state');
    if(receipts.length)await client.execute("DELETE FROM project_command_receipt WHERE command_type LIKE 'editor.%'");
    console.log('Retired editing records archived locally; media assets preserved.');
  }
  if(tables.includes('project'))await client.execute("UPDATE project SET last_workspace_mode='canvas' WHERE last_workspace_mode='editor'");
} finally {client.close();}
