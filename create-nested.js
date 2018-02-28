var ParameterizedSQL = require('loopback-connector/lib/parameterized-sql');
var _async = require('async');
var SG = require('strong-globalize');
var g = SG();
var util = require('util');
module.exports = function(Model){

var createNested = function(){

}

createNested.prototype.init = function(Model){
  this.model = Model;
  this.modelName = this.model.modelName;
  this.datasource = this.model.getDataSource();
  this.connector = this.datasource.connector;
  this.Transaction = this.datasource.DataAccessObject.Transaction;
  this.relationData = this.getRelations(this.model.relations);
  this.schema = this.connector.schema(this.modelName);
  this.modelTable = this.datasource.tableName(this.modelName);
  this.modelProperties = this.model.definition.properties;
}


createNested.prototype.create = function(data,options,masterCB){
  var self = this;
  var recordedData = [];
  var accessToken  = options.accessToken;
  this.Transaction.begin(this.connector,{isolationLevel:'READ COMMITTED'},function(err,tx){
    if(err != null){
      throw new Error(g.f('createNested error in connector.beginTransaction %s',err));
      masterCB(err);
    }
    else{
      var blocks = self.processData(data,tx,accessToken);
      if(Object.prototype.toString.call(blocks) == "[object Array]"){
      _async.eachOf(blocks,
          function(block,index,cb){
            block().then(function(data){
              recordedData[index] = data;
              cb();
            }).catch(function(err){
               cb(err);
            })
          },
          function(error){
            if(error){
              tx.rollback(function(rollbackError){
                if(rollbackError){ masterCB(rollbackError); }
                else{ masterCB(error); }});
            }
            else{
              tx.commit(function(commitError){
                if(commitError){ masterCB(commitError); }
                else{ masterCB(null,recordedData);}})
            }})
          }else if(Object.prototype.toString.call(blocks) == "[object Function]"){
            blocks().then(function(recordedData){
              tx.commit(function(commitError){
                if(commitError){ masterCB(commitError); }
                else{ masterCB(null,recordedData); }})
              }).catch(function(error){
                tx.rollback(function(rollbackError){
                  if(rollbackError){ masterCB(rollbackError); }
                  else{ masterCB(error); }});
              })
          }
      }
  });
}

createNested.prototype.getRelations = function(relations){
  relationData = {}
  for(var relation in relations){
      tmp = {};
      tmp.name  = relations[relation].name;
      tmp.modelTo = relations[relation].modelTo.definition.name;
      tmp.modelToTable = this.connector.schema(tmp.modelTo)+"."+this.datasource.connector.table(tmp.modelTo);
      tmp.keyTo = relations[relation].keyTo;
      tmp.modelToProperties = relations[relation].modelTo.definition.properties;
      tmp.modelFrom = relations[relation].modelFrom.definition.name;
      tmp.modelFromTable = this.connector.schema(tmp.modelFrom)+"."+this.datasource.connector.table(tmp.modelFrom);
      tmp.keyFrom = relations[relation].keyFrom;
      if((relations[relation].type == "hasMany" && typeof relations[relation].modelThrough == 'undefined')
        || relations[relation].type == "belongsTo" || relations[relation].type == "hasOne" ){
        tmp.type = relations[relation].type;
      }
      if(relations[relation].type == "hasMany" && typeof relations[relation].modelThrough != 'undefined'){
        tmp.type = "hasManyThrough";
        tmp.modelThrough = relations[relation].modelThrough.definition.name;
        tmp.modelThroughTable  = this.datasource.connector.schema(tmp.modelThrough)+"."+this.datasource.connector.table(tmp.modelThrough);
        tmp.keyThrough = relations[relation].keyThrough;
      }
      relationData[relations[relation].name] = tmp;

  }
  return relationData;
}

createNested.prototype.makeRootFunc = function(data,model,modelName,relationName,tx,accessToken){
  return function(parentModel = false){
        var tmpModel = null;
        if(parentModel == false ){
          tmpModel = new model(data);
        }else{
          tmpModel = parentModel[relationName].build(data);
        }
        var createMethod = null;
        for(let method of model.sharedClass._methods){
          if(method.name == 'create'){
            var createMethod = method;
            break;
          }
        }
        return new Promise(function(resolve,reject){
          model.checkAccess(accessToken,modelName,createMethod,function(error,status){
              if(error){ reject(error);}
              else{
                if(!status){ reject("Access to method "+modelName+".create() is not allowed"); }
                else{ model.create(tmpModel,{transaction:tx,validate:true},function(error,data){
                      if(error){ reject(error) }
                      else{ resolve(data)}});}
              }
          });
        })
  }
}

createNested.prototype.makeLeafFuncs = function(data,relationData,tx,accessToken){
  var self = this;
  var leafFuncs = [];
  for(var property in data){
    if(typeof relationData[property] != 'undefined'){
      var leaf_rel_name = property;
      var leaf_model_name = relationData[leaf_rel_name].modelTo;
      var leaf_rel_type   = relationData[leaf_rel_name].type;
      var leaf_data       = data[property];
      var type = Object.prototype.toString.call(leaf_data);
      switch(leaf_rel_type){
        case 'hasOne':
            if(type == "[object Array]"){ leaf_data = leaf_data[0]; }
            else if(type != "[object Object]") continue;
            break;
        case 'hasMany':
            if(!(type == "[object Object]" || type == "[object Array]")){
              continue;
            }
            break;
      }
      var leafFunc = function(){
        return {rel_type:leaf_rel_type,rel_name:leaf_rel_name,funcs:self.processData(leaf_data,tx,accessToken,leaf_model_name,leaf_rel_name)};
      }
        leafFuncs.push(leafFunc);
      }
    }
    return leafFuncs;
}

createNested.prototype.makeMasterFunc = function(rootFunc,leafFuncs){
  if(leafFuncs.length >0){
    master_func = function(parent_model = false){
      return new Promise(function(resolve,reject){
        var recordedData = null;
        rootFunc(parent_model).then(function(recordedModel){
            recordedData = recordedModel.toJSON();
            _async.each(leafFuncs,function(leafFunc,leafFuncsCB){
              leaf_func_data = leafFunc();
              var endFuncs     = leaf_func_data.funcs;
              var rel_name     = leaf_func_data.rel_name;
              var endFuncsType = Object.prototype.toString.call(endFuncs);
              switch(leaf_func_data.rel_type){
                case 'hasOne':
                  endFuncs(recordedModel).then(function(rdata){
                    recordedData[rel_name] = rdata;
                    parentCB();
                  }).catch(function(err){
                    parentCB(err);
                  });
                  break;
                case 'hasMany':
                  recordedData[rel_name] = [];
                  if(endFuncsType == "[object Function]"){
                    endFunc = endFuncs;
                    endFuncs = [];
                    endFuncs.push(endFunc);
                  }
                  _async.eachOf(endFuncs,
                    function(endFunc,index,endFuncsCB){
                      endFunc(recordedModel).then(function(rdata){
                      recordedData[rel_name][index] = rdata;
                      endFuncsCB();
                      }).catch(function(err){
                        endFuncsCB(err);
                      })},
                    function(err){
                      if(err){
                        leafFuncsCB(err);
                      }else{
                        leafFuncsCB();
                      }
                    });
                  break;
              }
            },
            function(err){
              if(err){
                reject(err);
              }
              else{
                resolve(recordedData);
              }
            });
        }).catch(function(err){
          reject(err)
        })
      });
    }
  }else{
    master_func = rootFunc;
  }
  return master_func;
}

createNested.prototype.processData = function(data,tx,accessToken,modelName = this.modelName,relationName = false){
  var self = this;
  var model        = Model.app.models[modelName];
  var connector    = Model.getDataSource().connector;
  var properties   = connector.getModelDefinition(modelName).properties;
  var relationData = this.getRelations(model.relations);
  var master_func = [];
  var master_funcs = [];
  if(Object.prototype.toString.call(data) == '[object Array]'){
    data.forEach(function(subdata){
      var leafFuncs   = [];
      var rootFunc    = self.makeRootFunc(subdata,model,modelName,relationName,tx,accessToken);
      var leafFuncs   = self.makeLeafFuncs(subdata,relationData,tx,accessToken);
      var master_func = self.makeMasterFunc(rootFunc,leafFuncs);
      master_funcs.push(master_func);
  });
  }
  else if(Object.prototype.toString.call(data) == '[object Object]'){
    var leafFuncs    = [];
    var rootFunc     = self.makeRootFunc(data,model,modelName,relationName,tx,accessToken);
    var leafFuncs    = self.makeLeafFuncs(data,relationData,tx,accessToken);
    var master_funcs = self.makeMasterFunc(rootFunc,leafFuncs);
  }
  return master_funcs;

}

var createNestedInstance = new createNested();

Model.on('attached',function(app){
  createNestedInstance.init(Model);
});

Model.createNested = function(data,options,cb){
  createNestedInstance.create(data,options,cb);
}

Model.remoteMethod('createNested', {
         description: 'Create a new instance of the model and persist it into the data source, including related models data',
         accessType: 'WRITE',
         accepts: [
           {
             arg: 'data', type: 'object', model: Model.modelName,allowArray: true,
             description: 'Model instance data including related models',
             http: { source: 'body'},
           },
           { arg: 'options', type: 'object', http: 'optionsFromRequest'}
         ],
         returns: {arg: 'data', type: Model.modelName, root: true},
         http: {path: '/createNested', verb: 'post'}
});

}
