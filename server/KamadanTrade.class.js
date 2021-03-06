var live_message_log = [];
var live_message_log_max = 100;
var search_results_max = 25;

var fs = require('fs');

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
function KamadanTrade() {
  this.flood_timeout = 10000; // ms to avoid user spamming trade chat i.e. 10s between the same message
  this.live_message_log = [];
  this.checked_table_exists = 0;
  this.table_prefix = 'kamadan_';
  this.last_message_by_user = {};
}
KamadanTrade.prototype.housekeeping = function() {
  // Clear down last_message_by_user if over 1 minute old.
  var one_minute_ago_in_seconds = (Date.now() / 1000) - 60;
  for(var i in this.last_message_by_user) {
    if(this.last_message_by_user[i].t < one_minute_ago_in_seconds)
      delete this.last_message_by_user[i];
  }
};
KamadanTrade.prototype.addTraderPrices = function(json) {
  var self = this;
  return new Promise(function(resolve,reject) {
    self.getTraderPrices().then(function(current_prices) {
      var updated_prices = [];
      var models_done = {buy:{},sell:{}};
      for(var key in models_done) {
        for(var i in json[key]) {
          var current = current_prices[key][json[key][i].m];
          if(models_done[key][json[key][i].m])
            continue;
          models_done[key][json[key][i].m] = 1;
          if(!current || current.p != json[key][i].p) {
            updated_prices.push({m:json[key][i].m,p:json[key][i].p,t:json[key][i].t,s:key == 'buy' ? 0 : 1});
          }
        }
      }
      if(!updated_prices.length) {
        console.log("No prices updated");
        return resolve(current_prices);
      }
      var sql_args = [];
      var sql_insert = [];
      for(var i in updated_prices) {
        sql_args.push(updated_prices[i].m);
        sql_args.push(updated_prices[i].p);
        sql_args.push(updated_prices[i].t);
        sql_args.push(updated_prices[i].s);
        sql_insert.push('(?,?,?,?)');
      }
      self.db.query("INSERT INTO trader_prices (m,p,t,s) VALUES "+sql_insert.join(','),sql_args).then(function(res) {
        console.log("Trader prices updated: "+res.affectedRows);
      }).finally(function() {
        self.getTraderPrices().then(function(prices) {
          resolve(prices);
        });
      });
    });
  });
  
}
KamadanTrade.prototype.getTraderPrices = function() {
  var self = this;
  var result = {buy:{},sell:{}};
  return new Promise(function(resolve,reject) {
    self.db.query("SELECT m,p,t,s FROM trader_prices GROUP BY m,s ORDER BY t DESC").then(function(rows) {
      for(var i=0;i<rows.length;i++) {
        var res = {p:rows[i].p,t:rows[i].t};
        if(rows[i].s) {
          result.sell[rows[i].m] = res;
        } else {
          result.buy[rows[i].m] = res;
        }
      }
    }).finally(function() {
      return resolve(result);
    });
  });
  
}
KamadanTrade.prototype.init = function() {
  var self = this;
  if(this.initted)
    return Promise.resolve();
  if(this.initting)
    return sleep(500).then(function() { return self.init(); });
  this.initting = true;
  console.log("Initialising KamadanTrade");
  
  this.quarantine_regexes = [];
  try {
    var regex_strings = (fs.readFileSync(__dirname+'/chat_filter_regexes.txt')+'').split('\n');
    for(var i=0;i<regex_strings.length;i++) {
      regex_strings[i] = regex_strings[i].trim();
      if(!regex_strings[i].length)
        continue;
      this.quarantine_regexes.push(new RegExp(regex_strings[i],'i'));
    }
    console.log("Chat filter regexes: ",this.quarantine_regexes);
    
  } catch(e) {
    console.error("Failed to parse "+__dirname+'/chat_filter_regexes.txt');
    console.error(e);
  }
  this.db = require(__dirname+'/KamadanDB.class.js');
  setInterval(function() {
    self.housekeeping();
  },30000);
  var year = (new Date()).getUTCFullYear();
  return this.db.init().then(function() {
    var create_statement = "(\
      t BIGINT(20) UNSIGNED NOT NULL COMMENT 'Unix timestamp with milliseconds',\
      s VARCHAR(20) NULL DEFAULT NULL COMMENT 'Sender',\
      m VARCHAR(120) NULL DEFAULT NULL COMMENT 'Message',\
      PRIMARY KEY (t),\
      INDEX s (s)\
    )\
    COLLATE='utf8mb4_general_ci'\
    ENGINE=InnoDB;";
    var item_prices_table = "CREATE TABLE IF NOT EXISTS trader_prices (\
      t BIGINT(20) UNSIGNED NOT NULL COMMENT 'Unix timestamp with milliseconds',\
      m INT UNSIGNED NOT NULL COMMENT 'model_id of quoted item',\
      s TINYINT NOT NULL COMMENT '1 if sell quote, 1 if buy quote',\
      p INT UNSIGNED NOT NULL COMMENT 'UTC timestamp of quote',\
      PRIMARY KEY (t,m),\
      INDEX m (m)\
      )\
      COLLATE='utf8mb4_general_ci'\
      ENGINE=InnoDB;";
    
    return Promise.all([
      self.db.query(item_prices_table),
      self.db.query("CREATE TABLE IF NOT EXISTS "+self.table_prefix+"searchlog ( term VARCHAR(100) NOT NULL, last_search BIGINT NOT NULL, count INT NOT NULL, PRIMARY KEY (term)) COLLATE='utf8mb4_general_ci'"),
      self.db.query("CREATE TABLE IF NOT EXISTS "+self.table_prefix+"quarantine "+create_statement),
      self.db.query("CREATE TABLE IF NOT EXISTS "+self.table_prefix+"deleted "+create_statement),
      self.db.query("CREATE TABLE IF NOT EXISTS whispers "+create_statement),
      self.db.query("CREATE TABLE IF NOT EXISTS "+self.table_prefix+(year-5)+" "+create_statement),
      self.db.query("CREATE TABLE IF NOT EXISTS "+self.table_prefix+(year-4)+" "+create_statement),
      self.db.query("CREATE TABLE IF NOT EXISTS "+self.table_prefix+(year-3)+" "+create_statement),
      self.db.query("CREATE TABLE IF NOT EXISTS "+self.table_prefix+(year-2)+" "+create_statement),
      self.db.query("CREATE TABLE IF NOT EXISTS "+self.table_prefix+(year-1)+" "+create_statement),
      self.db.query("CREATE TABLE IF NOT EXISTS "+self.table_prefix+(year)+" "+create_statement),
      self.db.query("CREATE TABLE IF NOT EXISTS "+self.table_prefix+(year+1)+" "+create_statement),
      self.db.query("CREATE TABLE IF NOT EXISTS "+self.table_prefix+(year+2)+" "+create_statement),
      self.db.query("CREATE TABLE IF NOT EXISTS "+self.table_prefix+(year+3)+" "+create_statement),
      self.db.query("CREATE TABLE IF NOT EXISTS "+self.table_prefix+(year+4)+" "+create_statement)
    ]).then(function() {
      return self.seedLiveMessageLog();
    });
  }).finally(function() {
    self.initting = false;
    self.initted = true;
    console.log("KamadanTrade initialised");
    return Promise.resolve();
  });
}
KamadanTrade.prototype.quarantineCheck = function(message) {
  // True on match
  //var msg_norm_auto = message.m.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
  var msg_norm_manual = message.m.removeDiacritics().removePunctuation().removeSpaces();
  for(var i in this.quarantine_regexes) {
    //if(this.quarantine_regexes[i].test(msg_norm_auto))
    //  return true;
    if(this.quarantine_regexes[i].test(msg_norm_manual))
      return true;
  }
  return false;
}
KamadanTrade.prototype.search = function(term,from_unix_ms,to_unix_ms) {
  var self = this;
  term = ((term || '')+'').toLowerCase().trim();
  this.db.query("INSERT INTO "+self.table_prefix+"searchlog (term,last_search,count) VALUES (?,?,1) ON DUPLICATE KEY UPDATE last_search = ?, count = count+1",[term,Date.now(),Date.now()]);
  var by_user = false;
  if(term.indexOf('user:') == 0) {
    by_user = true;
    term = term.substring(5);
  }
  if(!term.length)
    return Promise.resolve(this.live_message_log);
  var to_date = new Date();
  var from_date;
  var latest_year;
  var earliest_year = 2015;
  if(typeof to_unix_ms != 'undefined' && to_unix_ms != 0) {
    console.log("to_unix_ms "+to_unix_ms);
    to_unix_ms = (to_unix_ms+'').trim();
    to_date = (new Date(parseInt(to_unix_ms)));
    if(to_date.getUTCFullYear() < 2010)
      throw "Invalid to date of "+to_unix_ms;
    if(to_date.getTime() > Date.now())
      to_date = new Date();
  }
  latest_year = to_date.getUTCFullYear();
  earliest_year = 2015;
  if(typeof from_unix_ms != 'undefined' && from_unix_ms != 0) {
    console.log("from_unix_ms "+from_unix_ms);
    from_unix_ms = (from_unix_ms+'').trim();
    from_date = (new Date(parseInt(from_unix_ms)));
    earliest_year = from_date.getUTCFullYear();
    if(earliest_year < 2010 || earliest_year > latest_year)
      throw "Invalid to date of "+to_unix_ms;
    if(from_date.getTime() > to_date.getTime())
      throw "Invalid to date of "+to_unix_ms;
  }
  console.log("Searching messages for "+term+", from "+from_date+" to "+to_date);
  return this.init().then(function() {
    var args = [];
    var where_clause = '';
    if(by_user) {
      // Search by user
      where_clause = " WHERE s = ? ";
      args.push(term);
    } else {
      // Split string by spaces
      var keywords = term.split(' ');
      where_clause = " WHERE m LIKE ? ";
      args = ['%'+keywords[0]+'%']
      for(var i=1;i<keywords.length;i++) {
        where_clause += "AND m LIKE ? ";
        args.push('%'+keywords[i]+'%');
      }
    }
    var rows_final = [];
    var searchYear = function(year) {
      if(year < earliest_year)
        return Promise.resolve(rows_final);
      var where = where_clause;
      if(year == earliest_year && from_date)
        where += " AND t > "+from_date.getTime();
      if(year == latest_year && to_date)
        where += " AND t < "+to_date.getTime();
      var sql = "SELECT t,s,m FROM kamadan."+self.table_prefix+year+" "+where+" ORDER BY t DESC LIMIT "+search_results_max;
      console.log(sql);
      return self.db.query(sql,args).then(function(rows) {
        for(var i in rows) {
          rows_final.push(rows[i]);
        }
        if(rows_final.length < search_results_max)
          return searchYear(year-1);
        return Promise.resolve(rows_final);
      });
    };
    return searchYear(latest_year);
  });
}
KamadanTrade.prototype.parseMessageFromRequest = function(req,timestamp) {
  var body = req.body || '';
  if(typeof body == 'string') {
    try {
      body = JSON.parse(body);
    } catch(e) {}
  }
  var message = {
    m:((body.m || body.message || '')+'').trim(),
    s:((body.s || body.sender || '')+'').trim(),
    t:timestamp
  }
  if(!message.m || !message.s)
    return new Error("Missing sender/message when creating message");
  
  // Parse message content
  message.m = message.m.replace(/\\(\\|\[|\])/g,'$1');
  // 2020-03-06: RMT adding garbage to the end of their message
  message.m = message.m.replace(/----[0-9]+$/,'');
  if(!message.m.length)
    return new Error("Message is empty");
  return message;
}
KamadanTrade.prototype.addWhisper = function(req,timestamp) {
  var message = this.parseMessageFromRequest(req,timestamp);
  var self = this;
  if(message instanceof Error)
    return Promise.reject(message);
  console.log("Whisper received from "+message.s+": "+message.m);
  self.db.query("INSERT INTO whispers (t,s,m) values (?,?,?)",[message.t,message.s,message.m]);
  // Do something with this whisper
  var matches;
  if(matches = /delete ([0-9]{13})/i.exec(message.m)) {
    // Someone wants to delete a trade message.
    var date = new Date(parseInt(matches[1],10));
    if(date.getUTCFullYear() < 2015 || date.getTime() > Date.now())
      return Promise.reject(new Error("Player "+message.s+" wants to delete message "+matches[1]+", but this is an invalid date"));
    var r = date.getTime();
    return new Promise(function(resolve,reject) {
      self.db.query("INSERT INTO "+self.table_prefix+"deleted SELECT * FROM "+self.table_prefix+date.getUTCFullYear()+" WHERE t = ? AND s = ?",[r,message.s]).then(function(res) {
        if(!res.affectedRows) 
          return reject(new Error("Player "+message.s+" wants to delete message "+matches[1]+", but no rows were affected"));
        self.db.query("DELETE FROM "+self.table_prefix+date.getUTCFullYear()+" WHERE t = ? AND s = ?",[r,message.s]);
        for(var i=0;i < self.live_message_log.length;i++) {
          if(self.live_message_log[i].t == r) {
            self.live_message_log.splice(i,1);
            break;
          }
        }
        // Success; return object with "r" set to timestamp of message to remove via connected clients.
        return resolve({r:r});
      });
    });
  }
  return Promise.resolve();
}
KamadanTrade.prototype.addMessage = function(req,timestamp) {
  var message = this.parseMessageFromRequest(req,timestamp);
  if(message instanceof Error)
    return Promise.reject(message);
  console.log("Trade message received OK");
  var quarantined = this.quarantineCheck(message);
  var table = this.table_prefix+(new Date()).getUTCFullYear();
  if(quarantined) {
    console.log("Message hit quarantine: "+message.m);
    table = this.table_prefix+'quarantine';
  }
  
  // Avoid spam by the same user (or multiple trade message sources!)
  var last_user_msg = this.last_message_by_user[message.s];
  if(last_user_msg && last_user_msg.m.removePunctuation() == message.m.removePunctuation()) {
    if(Math.abs(message.t - last_user_msg.t) < this.flood_timeout) {
      console.log("Flood filter hit for "+last_user_msg.s+", "+Math.abs(message.t - last_user_msg.t)+"ms diff");
      return Promise.resolve(false);
    }
    // Avoid spammers adding random chars to their trade message by consolidating it.
    message.m = last_user_msg.m;
  }
  var self = this;

  // database message log
  return new Promise(function(resolve,reject) {
    var done = function() {
      self.last_message_by_user[message.s] = message;
      if(quarantined)
        return resolve(false);
      // live message log
      self.live_message_log.unshift(message);
      if(message.r) {
        for(var i=0;i < self.live_message_log.length;i++) {
          if(self.live_message_log[i].t == message.r) {
            self.live_message_log.splice(i,1);
            break;
          }
        }
      }
      while(self.live_message_log.length > live_message_log_max) {
        self.live_message_log.pop();
      }
      self.last_message = message;
      return resolve(message);
    };
    self.init().then(function() {
      // If this user has advertised this message in the last 14 weeks, just update it.
      return self.db.query("SELECT t FROM "+table+" WHERE s = ? AND m = ? AND t > ? ORDER BY t DESC LIMIT 1",[message.s,message.m,message.t - (864e5 * 14)]).then(function(res) {
        if(res.length) {
          message.r = res[0].t;
          return self.db.query("UPDATE "+table+" SET t = ? WHERE t = ?",[message.t,res[0].t]).then(function() {
            return done();
          });
        }
        // None updated; INSERT.
        return self.db.query("INSERT INTO "+table+" (t,s,m) values (?,?,?)", [message.t,message.s,message.m]).then(function(res) {
          return done();
        }); 
      });
    });
  });
}
KamadanTrade.prototype.getMessagesByUser = function(term,from_unix_ms,to_unix_ms) {
  return this.search.apply(this,arguments);
  var self = this;
  term = ((term || '')+'').toLowerCase().trim();
  if(!term.length)
    return Promise.resolve([]);
  var year = (new Date()).getUTCFullYear();
  if(earlier_than) {
    earlier_than = parseInt(earlier_than,10);
    year = (new Date(earlier_than)).getUTCFullYear();
  }
  console.log("Searching user message for "+term);
  return this.init().then(function() {
    return self.db.query("SELECT t,s,m FROM kamadan."+self.table_prefix+year+" WHERE s LIKE ? ORDER BY t DESC LIMIT "+live_message_log_max,[term])
      .then(function(rows) {
        return Promise.resolve(rows || []);
      });
  });
}
KamadanTrade.prototype.getMessagesSince = function(h) {
  var slice_end = 0;
  while(slice_end < this.live_message_log.length && this.live_message_log[slice_end].h != h) {
    slice_end++;
  }
  return this.live_message_log.slice(0,slice_end);
}
KamadanTrade.prototype.seedLiveMessageLog = function() {
  var self = this;
  var year = (new Date()).getUTCFullYear();
  return this.db.query("SELECT t, s, m\
  FROM kamadan."+self.table_prefix+year+" \
  ORDER BY t desc \
  LIMIT "+live_message_log_max).then(function(rows) {
    self.live_message_log = rows;
    self.last_message = self.live_message_log[0];
    console.log(self.live_message_log.length+" messages retrieved from db");
    return Promise.resolve();
  });
}

if(module && module.exports) {
  module.exports.KamadanTrade = KamadanTrade;
}