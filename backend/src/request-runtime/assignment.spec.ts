import { describe, expect, it } from 'vitest';
import { RequestRuntimeService } from './request-runtime.service.js';
function setup(destination:string, active=true) {
 const receipt=new Map();let writes=0;const row:any={id:'r',lockVersion:2,status:'em_atendimento',requesterId:'author',beneficiaryId:'beneficiary',currentCycle:1,queue:{bpmMembers:[{collaboratorId:'manager',role:'manager',active:true},{collaboratorId:destination,role:'member',active:true}]}};
 const tx:any={$queryRaw:async()=>[],requestCommandReceipt:{findUnique:async({where}:any)=>receipt.get(where.actorUserId_key.key),create:async({data}:any)=>receipt.set(data.key,{...data,id:'receipt'})},user:{findFirst:async()=>active?{id:'destination-user'}:null},request:{updateMany:async()=>{writes++;return{count:1};},findUnique:async()=>row},activityInstance:{update:async()=>({})},activityCandidate:{findFirst:async()=>null,create:async()=>({})},activityAssignment:{updateMany:async()=>({count:1}),create:async()=>({})},requestRuntimeIncident:{updateMany:async()=>({count:1})}};
 const actor:any={userId:'manager-user',collaboratorId:'manager',permissions:['request:update','request:assign'],roles:[]};
 const service:any=new RequestRuntimeService({user:{findUnique:async()=>({status:'active',collaboratorId:'manager',userRoles:[{role:{rolePermissions:actor.permissions.map((p:string)=>{const[resource,action]=p.split(':');return{permission:{resource,action}};})}}]})},$transaction:async(fn:any)=>fn(tx)} as any,{get:()=> 'true'} as any);
 service.activity=async()=>({id:'a',instanceId:'i',instance:{requestId:'r'},state:'available'});service.requestAccess=async()=>row;service.event=async()=>({id:'event'});
 return{service,actor,writes:()=>writes,command:{expectedVersion:2,commandKey:'assign-key',commandId:'cmd',assigneeId:destination,reason:'Explicit reassignment'}};
}
describe('manager assignment eligibility',()=>{
 it.each([['author',true],['beneficiary',true],['disabled',false]])('rejects %s without changing assignments or revision',async(destination,active)=>{const f=setup(destination,active);await expect(f.service.reassign('a',f.command,f.actor)).rejects.toThrow();expect(f.writes()).toBe(0);});
 it('allows a manager outside candidates to assign an eligible member and replays once',async()=>{const f=setup('executor');await f.service.reassign('a',f.command,f.actor);expect((await f.service.reassign('a',f.command,f.actor)).replay).toBe(true);expect(f.writes()).toBe(1);});
});
