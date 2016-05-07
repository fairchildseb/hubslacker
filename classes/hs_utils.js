
//    - -   REQUIRED MODULES    - -     //

var request = require('request')
var querystring = require('querystring');
var mongoose =  require('mongoose');


var fs = require('fs');

//    - -   APP MODULES  - -     //
/*
 *  @param Oauth {} mongoDb schema for HS Oauth tokens
 */

var Database = require('../database/db')();
var slackUtils = require('./slack_utils');
var OauthTokens = require('../database/models/OauthTokens');
var hubspotMetaData = require('../database/models/hubspotMetaData');
var messageMetaData = require('../database/models/messageMetaData');


//    - -   EXPORTS     - -     //

module.exports.get_token = get_token;
module.exports.refresh = refresh;
module.exports.getContactProperties = getContactProperties;
module.exports.formatNewLeadPostBody = formatNewLeadPostBody;


//    - -   ENV VARIABLES   - - //
/*
 *  @param TTL String - refresh token TTL
 */

var TTL = process.env["TTL"];



//    - -   METHODS     - -   //


// gets cached refresh token
function get_token (id, cb) {

  OauthTokens.where("user_id", id).then(function(d){

/*    var dateNow = new Date();
    var refreshedTime = new Date(d[0].hs_access.refreshed);
    var accessToken =  d[0].hs_access.access_token; */
    var refreshToken = d[0].hs_access.refresh_token;

    refresh(refreshToken, id, OauthTokens, cb);
  });  

}


// gets a new access token
function refresh(refreshToken, id, OauthTokens, cb){

  // post body
  var body =  querystring.stringify({
    refresh_token: refreshToken,
    client_id :process.env["HS_CLIENT_ID"],
    grant_type : "refresh_token"
  });

  // POST to HS auth api
  request({
    method: "POST",
    uri : "https://api.hubapi.com/auth/v1/refresh",
    body : body
    }, 
    function(err, res, d){
      if(err) console.log(err);
      
      var responseBody = JSON.parse(d);

      // execute callback
      cb(responseBody.access_token, id);

      // inserts new refresh token
      Database.upsert(OauthTokens,
        {
          hs_access : {
            //access_token: responseBody.access_token,
            refresh_token: responseBody.refresh_token,
            //refreshed : new Date()
          }
        }, 
      id);
    }
  )

}


// lists all HubSpot Contact properties
function getContactProperties(accessToken, id){


  options = {
    method : "GET",
    uri : "https://api.hubapi.com/contacts/v2/properties?access_token=" + accessToken
  }

  // GET request
  request(options, function(err, res, d){
    if(err) console.log(err);
    formatContactProperties(JSON.parse(d), id);
  });

}

function formatContactProperties(d, id){
  
  var properties = {};
  var property_group = [];
  var upsertObj = {};

  
  d.forEach(function(d){
    property_group.push(d.groupName);
    if(!d.hidden){
      properties[d.name] = {
        name : d.name,
        label : d.label,
        groupName : d.groupName,
        default_selection : (function(name){
          if(name === 'firstname' || name === 'lastname' || name === 'email' || name === 'phone'){
            return true;
          } return false;
        })(d.name)
      };
    }
  });

  upsertObj.properties = properties;
  
  // removes duplicate entries from properties array
  upsertObj.property_group = property_group.filter( function( item, index, inputArray ) {
    return inputArray.indexOf(item) == index;
  });


  // updates MetaData tables
  Database.upsert(hubspotMetaData, upsertObj, id);
  Database.upsert(messageMetaData, { selected_properties : ['firstname', 'lastname', 'email', 'phone']}, id);
}

function formatNewLeadPostBody (id, metaData, post){
  var text, message;
  message = {};
  message.channel = metaData.default_channel;
  message.text = 'You have a new lead!\n';

  metaData.selected_properties.forEach(function(d){
    if(post['firstname'] && d === 'firstname'){
      message.text += `${post[d].value} `;
      if(post['lastname']){
        message.text += `${post['lastname']}\n`;
      }
    }
    if(post[d]){
      if(d !== 'firstname' || d !== 'lastname')
        message.text += `d ${post[d].value} `;
      }
  });

  slackUtils.getToken(id, slackUtils.postMessage, message);
}
