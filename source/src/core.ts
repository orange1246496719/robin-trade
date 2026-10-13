import { AbiCoder, Interface, ZeroAddress, getAddress, parseEther } from 'ethers';
export const ROUTER='0xebe7b6c1089d9f72ad07f34e36d898e44e5e27f3';
export const IMPLEMENTATION='0x8ca6f8692bc87c18e9e94e1941c6b634ddf3a52d';
export const SLOT='0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc';
export const CHAIN='0x1237';
export const RPC='https://rpc.mainnet.chain.robinhood.com';
export const EXPLORER='https://robin.etherscan.io';

export function parseInputs(ca:string,amount:string,slippage:string){
 const token=getAddress(ca.trim());if(token===ZeroAddress)throw Error('CA 不能为零地址');
 if(!/^(0|[1-9]\d*)(\.\d{1,18})?$/.test(amount.trim()))throw Error('ETH 数量须为普通十进制，最多 18 位小数');
 const value=parseEther(amount.trim());if(value<=0n)throw Error('ETH 数量必须大于零');
 if(!/^\d+(\.\d{1,2})?$/.test(slippage.trim()))throw Error('滑点最多两位小数');
 const bps=Math.round(Number(slippage)*100);if(!Number.isSafeInteger(bps)||bps<0||bps>2000)throw Error('滑点须在 0–20%');
 return {token,amount:value,bps};
}
export function encodeBuy(token:string,amount:bigint,min:bigint){
 if(min<=0n||amount<=0n)throw Error('数量和最低接收量必须大于零');
 return '0x995ee6da'+AbiCoder.defaultAbiCoder().encode(['address','uint256','uint256','address','bytes'],[getAddress(token),amount,min,ZeroAddress,'0x']).slice(2);
}
export function encodeSell(token:string,amount:bigint,min:bigint){return encodeBuy(token,amount,min).replace(/^0x995ee6da/,'0x8bfc7764');}
// A successful probe never establishes an upper bound. Require the exact independently
// verified minimum-output revert, with bounded doubling in native wei (not token supply).
export async function searchNativeOutput(probe:(minimum:bigint)=>Promise<string>,progress?:(n:number)=>void){
 await probe(1n);let low=1n,high=10n**18n,calls=1,bracket=false;
 for(let i=0;i<32;i++){calls++;try{await probe(high);low=high;high*=2n;}catch(e){if(!minimumError(e))throw e;bracket=true;break;}}
 if(!bracket)throw Error('无法验证 ETH 上界：停止');
 let n=0;const tolerance=()=>low/100000n>1n?low/100000n:1n;
 while(high-low>tolerance()&&n<100){const mid=(low+high)/2n;calls++;try{await probe(mid);low=mid;}catch(e){if(!minimumError(e))throw e;high=mid;}progress?.(++n);}
 if(high-low>tolerance())throw Error('ETH 搜索未收敛');return {low,high,calls};
}
export function minimumError(e:unknown){const x=e as {code?:unknown;data?:unknown};return x?.code==='CALL_EXCEPTION'&&x.data==='0x09d703a0';}
export async function searchOutput(supply:bigint,probe:(minimum:bigint)=>Promise<string>,progress?:(n:number)=>void){
 if(supply<1n||supply>=2n**256n-1n)throw Error('totalSupply 无法建立安全上界');
 try{await probe(1n);}catch{throw Error('最低接收量 1 的基线模拟失败，停止');}
 let low=1n,high=supply+1n;
 try{await probe(high);throw Error('上界未失败，不能安全推导报价');}catch(e){if(!minimumError(e))throw e;}
 const tolerance=()=>low/100000n>1n?low/100000n:1n;
 let n=0;while(high-low>tolerance()&&n<40){
  const mid=(low+high)/2n;
  try{await probe(mid);low=mid;}catch(e){if(!minimumError(e))throw e;high=mid;}
  n++;progress?.(n);
 }
 if(high-low>tolerance())throw Error('40 次搜索未收敛，停止');
 return {low,high,calls:n+2};
}
export function protectedMinimum(low:bigint,bps:number){
 if(!Number.isInteger(bps)||bps<0||bps>2000)throw Error('滑点超限');
 const min=low*BigInt(10000-bps)/10000n;if(min<=0n)throw Error('最低接收量取整为零，停止');return min;
}
export type Identity={generation:number;account:string;chain:string;input:string};
export type FreshQuote=Identity&{created:number};
export function isFresh(q:FreshQuote,s:Identity&{now:number}){return s.now>=q.created&&s.now-q.created<=60000&&q.generation===s.generation&&q.account.toLowerCase()===s.account.toLowerCase()&&q.chain.toLowerCase()===s.chain.toLowerCase()&&q.input===s.input;}
export function checkImplementation(word:string){if(!/^0x[0-9a-f]{64}$/i.test(word)||BigInt(word)!==BigInt(IMPLEMENTATION))throw Error('路由器实现已变化或无法验证：停止，不自动更新');}
const transfer=new Interface(['event Transfer(address indexed from,address indexed to,uint256 value)']);
export function receivedNet(logs:ReadonlyArray<{address:string;topics:readonly string[];data:string}>,token:string,buyer:string){
 let total=0n;for(const log of logs){if(log.address.toLowerCase()!==token.toLowerCase())continue;
 try{const event=transfer.parseLog({topics:[...log.topics],data:log.data});if(!event)continue;
 if(event.args.to.toLowerCase()===buyer.toLowerCase())total+=event.args.value;
 if(event.args.from.toLowerCase()===buyer.toLowerCase())total-=event.args.value;
 }catch{/* Not an ERC20 Transfer. */}}
 return total;
}
export type Pending={phase:'intent'|'uncertain'|'sent';hash?:string;created:number;[key:string]:unknown};
type StorageLike=Pick<Storage,'getItem'|'setItem'|'removeItem'>;
export class PendingStore {
 static key='robin-buy.pending.v1';
 constructor(private storage:StorageLike){}
 read():Pending|null{const raw=this.storage.getItem(PendingStore.key);if(!raw)return null;try{const p=JSON.parse(raw);if(!p||!['intent','uncertain','sent'].includes(p.phase))throw Error();return p;}catch{throw Error('本地待处理记录损坏：禁止重复提交，请人工核对');}}
 write(p:Pending){this.storage.setItem(PendingStore.key,JSON.stringify(p));}
 clear(){this.storage.removeItem(PendingStore.key);}
 async send(intent:Record<string,unknown>,send:()=>Promise<string>){
 if(this.read())throw Error('存在未核对的交易，禁止重复提交');
 const record:Pending={...intent,phase:'intent',created:Date.now()};this.write(record);
 let hash:string;try{hash=await send();}catch(e){if((e as {code?:unknown})?.code===4001)this.clear();else this.write({...record,phase:'uncertain'});throw e;}
 if(!/^0x/.test(hash)){this.write({...record,phase:'uncertain'});throw Error('钱包未返回有效交易哈希');}
 this.write({...record,phase:'sent',hash});return hash;
 }
}
