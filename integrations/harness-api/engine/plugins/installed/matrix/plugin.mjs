export default {
  name:'octoport-matrix',
  inject:['octoportPlugins'],
  apply(ctx,{manifest,execute}){
    ctx.octoportPlugins.register(ctx,manifest,{
      async process({scope,text,signal}){
        return execute({actor_id:scope.actor_id,tenant_id:scope.tenant_id,session_id:scope.session_id,request_id:scope.request_id,text},signal);
      },
    });
  },
};
