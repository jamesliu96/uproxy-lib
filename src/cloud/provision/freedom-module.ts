/// <reference path='../../../../third_party/typings/freedom/freedom-module-env.d.ts' />
/// <reference path='../../../../third_party/typings/es6-promise/es6-promise.d.ts' />

// TODO: import forge typings
declare var forge:any;

var POLL_TIMEOUT = 5000; //milliseconds

var STATUS_CODES :{[code:string]:string} = {
  "START": "Starting provisioner",
  "OAUTH_INIT": "Initializing oauth flow",
  "OAUTH_ERROR": "Error getting oauth token",
  "OAUTH_COMPLETE": "Got oauth token",
  "SSHKEY_RETRIEVED": "Retrieved SSH keys from storage",
  "SSHKEY_GENERATED": "Generated new SSH keys",
  "CLOUD_FAILED": "Failed to complete cloud operation",
  "CLOUD_INIT_ADDKEY": "Starting to add SSH key to cloud account",
  "CLOUD_DONE_ADDKEY": "Done adding SSH key to cloud account",
  "CLOUD_INIT_VM": "Starting to provision VM",
  "CLOUD_DONE_VM": "Done provisioning VMs",
  "CLOUD_WAITING_VM": "Waiting on VM",
};

var ERR_CODES = {
  "VM_DNE": "VM does not exist",
  "CLOUD_ERR": "Error from cloud provider"
};

var REDIRECT_URIS = [
  "https://pjpcdnccaekokkkeheolmpkfifcbibnj.chromiumapp.org"
  //  "http://localhost:10101"
];

class Provisioner {

  private state = {};

  constructor (private dispatchEvent_:(name:string, args:Object) => void) {}

  /**
   * Dispatches status events
   * events listed in STATUS_CODES
   * @param {String} code - one of STATUS_CODES 
   **/
  private _sendStatus = (code:string) => {
    this.dispatchEvent_("status", {
      "code": code,
      "message": STATUS_CODES[code]
    });
  }

  /*
   * Generates an RSA keypair using forge
   * @return {Object.<String,String>} public and private SSH keys
   */
  private _generateKeyPair = () => {
    "use strict";
    var pair = forge.pki.rsa.generateKeyPair({bits: 2048, e: 0x10001});
    var publicKey = forge.ssh.publicKeyToOpenSSH(pair.publicKey, '');
    var privateKey = forge.ssh.privateKeyToOpenSSH(pair.privateKey, '');
    return {
      public: publicKey,
      private: privateKey
    };
  }

  /**
   * Initiates a Digital Ocean oAuth flow
   * @return {Promise.<Object>} oAuth response from Digital Ocean
   *  {
   *    access_token: "..",
   *    expires_in: "..",
   *    state: "..",
   *    token_type: ".."
   *  }
   **/
  private _doOAuth = () => {
    return new Promise((resolve, reject) => {
      // TODO: import oauth typings
      var oauth :any = freedom["core.oauth"]();

      this._sendStatus("OAUTH_INIT");
      oauth.initiateOAuth(REDIRECT_URIS).then((obj:any) => {
        var url = "https://cloud.digitalocean.com/v1/oauth/authorize?" +
                  "client_id=c16837b5448cd6cf2582d2c2f767cfb7d11844ec395a91b43f26ca72513416c8&" +
                  "response_type=token&" +
                  "redirect_uri=" + encodeURIComponent(obj.redirect) + "&" +
                  "state=" + encodeURIComponent(obj.state) + "&" +
                  "scope=read%20write";
        return oauth.launchAuthFlow(url, obj);
      }).then(function(responseUrl:string) {
        var query = responseUrl.substr(responseUrl.indexOf('#') + 1),
          param:string,
          params = {},
          keys = query.split('&'),
          i = 0;

        for (i = 0; i < keys.length; i += 1) {
          param = keys[i].substr(0, keys[i].indexOf('='));
          params[param] = keys[i].substr(keys[i].indexOf('=') + 1);
        }

        this._sendStatus("OAUTH_COMPLETE");
        resolve(params);
      }).catch((err:Error) => {
        console.error("oauth error: " + JSON.stringify(err));
        this._sendStatus("OAUTH_ERROR");
        reject(err)
      });
    });
  };

  /**
   * Try to retrieve SSH keys from storage.
   * If not found, generate new ones and store
   * @param {String} name of the key (usually same as name of VM later)
   * @return {Object}
   * {
   *    public: "...",
   *    private: "..."
   * }
   **/
  private _getSshKey = (name:string) => {
    var storage = freedom["core.storage"]();
    return new Promise((resolve, reject) => {
      var result = {};

      Promise.all([
        storage.get("DigitalOcean-" + name + "-PublicKey"),
        storage.get("DigitalOcean-" + name + "-PrivateKey")
      ]).then((val) => {
        if (val[0] === null ||
           val[1] === null) {
          result = this._generateKeyPair();
          storage.set("DigitalOcean-" + name + "-PublicKey", result.public);
          storage.set("DigitalOcean-" + name + "-PrivateKey", result.private);
          this._sendStatus("SSHKEY_GENERATED");
        } else {
          result.public = val[0];
          result.private = val[1];
          this._sendStatus("SSHKEY_RETRIEVED");
        }
        resolve(result);
      }).catch((err:Error) => {
        console.error("storage error: " + JSON.stringify(err));
        reject(err);
      });
    });
  };

  /**
   * Make a request to Digital Ocean
   * @param {String} method - GET/POST/DELETE etc
   * @param {String} actionPath - e.g. "droplets/"
   * @param {String} body - if POST, contents to post
   * @return {Promise.<Object>} - JSON object of response body
   **/
  private _doRequest = (method:string, actionPath:string, body:string) => {
    return new Promise((resolve, reject) => {
      var url = 'https://api.digitalocean.com/v2/' + actionPath;
      var xhr = freedom["core.xhr"]()
      xhr.on("onload", () => {
        xhr.getResponseText().then((resp:any) => {
          try {
            var json = JSON.parse(resp);
            resolve(json);
          } catch(e) {
            reject(e);
          }
        });
      });
      xhr.on("onerror", reject);
      xhr.on("ontimeout", reject);
      xhr.open(method, url, true);
      xhr.setRequestHeader("Authorization", "Bearer " + this.state.oauth.access_token);
      xhr.setRequestHeader("Content-Type", "application/json");
      if (body !== null && typeof body !== "undefined") {
        xhr.send({ string: body })
      } else {
        xhr.send(null);
      }
    });
  };

  /** 
   * Waits for all in-progress Digital Ocean actions to complete
   * e.g. after powering on a machine, or creating a VM
   * @param {Function} resolve - call when done
   * @param {Function} reject - call on failure
   **/
  private _waitDigitalOceanActions = (resolve, reject) => {
    console.log("Polling for Digital Ocean in-progress actions");
    this._doRequest("GET", "droplets/" + this.state.cloud.vm.id + "/actions").then((resp) => {
      for (var i = 0; i < resp.actions.length; i++) {
        if (resp.actions[i].status === "in-progress") {
          setTimeout(this._waitDigitalOceanActions.bind(this, resolve, reject), POLL_TIMEOUT);
          return;
        }
      }
      resolve(resp);
    }).catch((e:Error) => {
      console.error("Error waiting for digital ocean actions:" + JSON.stringify(e));
      reject(e)
    });
    
  };

  /**
   * Properly configure Digital Ocean with a single droplet of name:name
   * Assumes we already have oAuth token and  SSH key in this.state
   * This method will use this._waitDigitalOceanActions() to wait until all actions complete
   * before resolving
   * @param {String} name of droplet
   * @return {Promise} resolves on success, rejects on failure
   **/
  private _setupDigitalOcean = (name:string) => {
    return new Promise((resolve, reject) => {
      this.state.cloud = {};

      this._sendStatus("CLOUD_INIT_ADDKEY");
      // Get SSH keys in account
      this._doRequest("GET", "account/keys").then((resp) => {
        //console.log(resp);
        for (var i = 0; i < resp.ssh_keys.length; i++) {
          if (resp.ssh_keys[i].public_key === this.state.ssh.public) {
            return Promise.resolve({
              message: "SSH Key is already in use on your account",
              ssh_key: resp.ssh_keys[i]
            });
          } 
        }
        return this._doRequest("POST", "account/keys", JSON.stringify({
          name: name,
          public_key: this.state.ssh.public
        }));
      // If missing, put SSH key into account
      }).then((resp) => {
        //console.log(resp);
        this.state.cloud.ssh = resp.ssh_key;
        this._sendStatus("CLOUD_DONE_ADDKEY");
        this._sendStatus("CLOUD_INIT_VM");
        return this._doRequest("GET", "droplets");
      // Get list of droplets
      }).then((resp) => {
        //console.log(resp);
        for (var i = 0; i < resp.droplets.length; i++) {
          if (resp.droplets[i].name === name) {
            return Promise.resolve({
              message: "Droplet already created with name=" + name,
              droplet: resp.droplets[i]
            });
          }
        }

        return this._doRequest("POST", "droplets", JSON.stringify({
          name: name,
          region: "nyc3",
          size: "512mb",
          image: "ubuntu-14-04-x64",
          ssh_keys: [ this.state.cloud.ssh.id ]
        }));
      // If missing, create the droplet
      }).then((resp) => {
        //console.log(resp);
        this.state.cloud.vm = resp.droplet;
       
        if (resp.droplet.status == "off") {
          // Need to power on VM
          return this._doRequest(
            "POST", 
            "droplets/" + resp.droplet.id + "/actions",
            JSON.stringify({ "type": "power_on" })
          ) 
        } else {
          return Promise.resolve();
        }
      // If the machine exists, but powered off, turn it on
      }).then((resp) => {
        //console.log(resp);
        this._sendStatus("CLOUD_WAITING_VM");
        this._waitDigitalOceanActions(resolve, reject);
      // Wait for all in-progress actions to complete
      }).catch((err:Error) => {
        console.error("Error w/DigitalOcean: " + err);
        this._sendStatus("CLOUD_FAILED");
        reject({
          errcode: "CLOUD_ERR",
          message: JSON.stringify(err)
        });
      });
    });
  }

  /**
   * One-click setup of a VM
   * See freedom-module.json for return and error types
   * @param {String} name of VM to create
   * @return {Promise.<Object>}
   **/
  public start = (name:string) => {
    this._sendStatus("START");
    // Do oAuth
    return this._doOAuth().then((oauthObj) => {
      this.state.oauth = oauthObj;
      return this._getSshKey(name);
    // Get SSH keys
    }).then((keys) => {
      this.state.ssh = keys;
      return this._setupDigitalOcean(name);
    // Setup Digital Ocean (SSH key + droplet)
    }).then((actions) => {
      //console.log(actions);
      return this._doRequest("GET", "droplets/"+this.state.cloud.vm.id);
    // Get the droplet's configuration
    }).then((resp) => {
      this._sendStatus("CLOUD_DONE_VM");
      this.state.cloud.vm = resp.droplet;
      this.state.network = {
        "ssh_port": 22
      }
      // Retrieve public IPv4 address
      for (var i = 0; i < resp.droplet.networks.v4.length; i++) {
        if (resp.droplet.networks.v4[i].type === "public") {
          this.state.network.ipv4 = resp.droplet.networks.v4[i].ip_address;
        }
      }
      // Retrieve public IPv6 address
      for (var i = 0; i < resp.droplet.networks.v6.length; i++) {
        if (resp.droplet.networks.v6[i].type === "public") {
          this.state.network.ipv6 = resp.droplet.networks.v6[i].ip_address;
        }
      }
      console.log(this.state);
      return this.state;
    });
  }

  /**
   * One-click destruction of a VM
   * See freedom-module.json for return and error types
   * @todo currently doesnt wait for destroy to complete before resolving
   * @param {String} name of VM to create
   * @return {Promise.<Object>}
   **/
  public stop = (name:string) => {
    return this._doRequest("GET", "droplets").then((resp) => {
      for (var i = 0; i < resp.droplets.length; i++) {
        if (resp.droplets[i].name === name) {
          return Promise.resolve({
            droplet: resp.droplets[i]
          });
        }
      }
      return Promise.reject({
        "errcode": "VM_DNE",
        "message": "Droplet with name," + name + ", doesnt exist"
      });
    }).then((resp) => {
      return this._doRequest("DELETE", "droplets/" + resp.droplet.id);
    });
  }
}

freedom().providePromises(Provisioner);
