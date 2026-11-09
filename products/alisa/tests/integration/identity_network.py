"""Owned ephemeral CI uid firewall; never operates on a stage/live host."""
import os,pwd,secrets,socket,subprocess,sys

class OwnedNetwork:
    uid=39391
    def __init__(self):self.chains=[]
    def setup(self):
        if os.geteuid()!=0 or os.environ.get('GITHUB_ACTIONS')!='true':
            raise RuntimeError('Network qualification requires the isolated GitHub Actions root job')
        try:pwd.getpwuid(self.uid)
        except KeyError:pass
        else:raise RuntimeError('Disposable uid already belongs to an account')
        self.name='ALISA_S02_'+secrets.token_hex(4)
        for tool,loopback in [('iptables','127.0.0.0/8'),('ip6tables','::1/128')]:
            self.run(tool,'-N',self.name);self.chains.append(tool)
            self.run(tool,'-A',self.name,'-d',loopback,'-j','RETURN')
            if tool=='iptables':
                # Docker's loopback publication can DNAT to its private bridge.
                self.run(tool,'-A',self.name,'-m','conntrack','--ctorigdst','127.0.0.0/8','-j','RETURN')
            self.run(tool,'-A',self.name,'-j','REJECT')
            self.run(tool,'-A','OUTPUT','-m','owner','--uid-owner',str(self.uid),'-j',self.name)
    def run(self,tool,*arguments):
        return subprocess.run([tool,'-w','5',*arguments],check=True,capture_output=True,text=True).stdout
    def witness(self,python,environment):
        # Reserved documentation IP, OS-blocked before any external packet leaves.
        script="import socket,sys\ntry:socket.create_connection(('198.51.100.1',443),timeout=.5)\nexcept OSError:sys.exit(0)\nsys.exit(1)"
        r=subprocess.run([str(python),'-c',script],env=environment,user=self.uid,group=self.uid,extra_groups=[],capture_output=True,timeout=3)
        counters=self.run('iptables','-L',self.name,'-n','-v','-x').splitlines()
        rejected=any(len(row.split())>2 and row.split()[2]=='REJECT' and int(row.split()[0])>0 for row in counters)
        return r.returncode==0 and rejected
    def close(self):
        for tool in reversed(self.chains):
            subprocess.run([tool,'-w','5','-D','OUTPUT','-m','owner','--uid-owner',str(self.uid),'-j',self.name],capture_output=True)
            self.run(tool,'-F',self.name);self.run(tool,'-X',self.name)
        self.chains=[]
