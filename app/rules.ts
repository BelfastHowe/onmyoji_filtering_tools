import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export const rulesVersion='yyshub-68d30cbe-1';
export const rulesDir=resolve(import.meta.dirname,'../local_data/rules',rulesVersion);
export const ruleFiles={
  'pvePreview-791b9fe7.js':'3d176db3bc12932fed42ed1e2fe4708bc822bef424d851deb409f50921fba905',
  'index-216a7005.js':'2ddca8a86d059daf556a56b2ba5e3e9afb32d49d5e5518b79c90ad3369d95c6e',
  'heroData-db59b10f.js':'3058a57780d3f59fab1b9ddd98e86236946ab0a8c72c389cd7a704277c2e8632',
  'calculator-70eebf65.js':'becf1a7bf6f40308ac708f5ac6b44361eec0ebe608078227d9a42264f0f0115f',
  'calcPanel-1f9cb473.js':'d2a85fa8ea329ef008d88cb20a3ac52a6582939c7940120ef8610dd13edaa6db',
  'teamBase-a28c33c3.js':'ee5db50080530f35ecd73459c6b7f0821ebcd68f3948d0400770ee9b550008ec',
  'oneKeyCalcTeam-68d30cbe.js':'f6aab68ad133ef404359ecaf39aaeb38208bcb0d0fdda61635c1e22bf4fa3e33',
  'calculatorWorker-309b3933.js':'5dddd26bb658c58f4ef51eaa85a769e70279e622a3cb218cd22eea0c441bd8e3'
};
export function verifyRule(name:keyof typeof ruleFiles, bytes:Buffer){
  if(createHash('sha256').update(bytes).digest('hex')!==ruleFiles[name])throw Error('规则校验失败 '+name);
  return bytes;
}
export function ruleText(name:keyof typeof ruleFiles){
  return verifyRule(name,readFileSync(resolve(rulesDir,name))).toString('utf8');
}
