if(typeof exec == 'undefined') {
  process.env.NODE_PATH = __dirname+'/../../node_modules';
  console.log(__dirname+'/../../node_modules');
  require("module").Module._initPaths();
   
}
var exec = exec || require('child_process').exec; 
exec('ps -elf | grep "[-]character"',function(a,stdout,c) {
  if(stdout.indexOf('-character') != -1)
    return;// console.log("Guild Wars client already running!\n"+stdout);
  console.log("Starting Guild Wars client!");
  exec('cd ~/kamadan-trade-client && sudo sh run_client.sh > /dev/null 2>&1');
});
return Promise.resolve();