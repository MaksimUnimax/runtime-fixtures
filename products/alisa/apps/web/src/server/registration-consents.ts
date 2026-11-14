export function registrationConsents(value:unknown):Record<string,unknown>|undefined{
  if(value===undefined)return undefined;
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('INVALID_CONSENT_PROOF');
  const entries=Object.entries(value);if(entries.length===0)return {};
  if(entries.length!==2||!Object.hasOwn(value,'service')||!Object.hasOwn(value,'privacy'))throw new Error('INVALID_CONSENT_PROOF');
  for(const [document,receipt] of entries){
    if(!['service','privacy'].includes(document)||!receipt||typeof receipt!=='object'||Array.isArray(receipt)
      ||Object.keys(receipt).sort().join(',')!=='accepted_at,version')throw new Error('INVALID_CONSENT_PROOF');
    const item=receipt as Record<string,unknown>;
    if(typeof item.version!=='string'||!['identity-s02-1','identity-s02-mail-1','identity-s02-open-1'].includes(item.version)
      ||typeof item.accepted_at!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|\+00:00)$/.test(item.accepted_at))throw new Error('INVALID_CONSENT_PROOF');
    const at=Date.parse(item.accepted_at);if(!Number.isFinite(at)||at<Date.UTC(2000,0,1)||at>Date.now()+60000)throw new Error('INVALID_CONSENT_PROOF');
  }
  return value as Record<string,unknown>;
}
