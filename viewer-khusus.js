// Lightweight role classifier used by ChatWidget Studio.
function createViewerKhusus(){
  const giftCounts=new Map(), likes=new Map();
  function userKey(d){const u=d?.user||d?.author||{};return String(u.uniqueId||u.unique_id||u.displayId||u.nickname||u.name||'viewer').toLowerCase()}
  function getTikTokRoles(d){const key=userKey(d),out=[];const u=d?.user||{};if(u.isModerator||u.isAdmin)out.push('tt_mod');if(u.isSubscriber)out.push('tt_fan');if((giftCounts.get(key)||0)>0)out.push('tt_gift');if((likes.get(key)||0)>0)out.push('tt_like');return out}
  function handleTikTokGift(d){const k=userKey(d);giftCounts.set(k,(giftCounts.get(k)||0)+Number(d?.repeatCount||d?.repeat_count||1))}
  function handleTikTokLike(d){const k=userKey(d);likes.set(k,(likes.get(k)||0)+Number(d?.likeCount||d?.count||1))}
  function getYouTubeRoles(d){const out=[];const badges=d?.author?.badges||d?.badges||[];const s=JSON.stringify(badges).toLowerCase();if(s.includes('moderator'))out.push('yt_mod');if(s.includes('member')||s.includes('sponsor'))out.push('yt_mem');if(s.includes('owner'))out.push('yt_super');return out}
  function reset(){giftCounts.clear();likes.clear()}
  return {getTikTokRoles,handleTikTokGift,handleTikTokLike,getYouTubeRoles,reset};
}
module.exports={createViewerKhusus};
