const ArgumentType = require('../../extension-support/argument-type');
const BlockType = require('../../extension-support/block-type');
const Clone = require('../../util/clone');
const Cast = require('../../util/cast');
const Timer = require('../../util/timer');
const request = require('request');
const RenderedTarget = require('../../sprites/rendered-target');
const ajax = require('es-ajax');
const iconURI = require('./assets/twitter_icon');

let server_url = 'http://localhost:3477/twitter/call';
class Scratch3Twitter {
    constructor (runtime) {
        this.runtime = runtime;
  
    }

    getInfo () {
        return {
            id: 'twitter',
            name: 'Twitter',
            blockIconURI: iconURI,
            blocks: [
                {
                    opcode: 'latestUserTweet',
                    blockType: BlockType.REPORTER,
                    text: 'Get the latest tweet from @[USER]',
                    arguments:{
                        USER: {
                            type: ArgumentType.STRING,
                            defaultValue: 'medialab'
                        }
                    }
                },
                {
                    opcode: 'getTopTweet',
                    blockType: BlockType.REPORTER,
                    text: 'Most [CATEGORY] tweet containing #[HASH]',
                    arguments:{
                        CATEGORY:{
                            type: ArgumentType.STRING,
                            menu: 'categories',
                            defaultValue: 'recent'
                        },
                        HASH:{
                            type: ArgumentType.STRING,
                            defaultValue: 'cognimates'
                        }
                    }
                }
                
            ],
            menus: {
             	categories: ['recent', 'popular']
            }
        };
    }

    latestUserTweet(args, util) {
        var user = args.USER;
        var params = {screen_name: user, count:1};
        var uri = 'statuses/user_timeline.json';
        request.post({
            url:     server_url,
            form:    { uri: uri, params: params}
            }, function(error, response, body){
            callback(error, body);
            });
    }

    getTopTweet(args, util){
        var category = args.CATEGORY;
        var hashtag = encodeURIComponent(args.HASH);
        var params = {q: hashtag, result_type: category, count: 1}
        request.get("/search/tweets", params,
            function(err, tweet, response){
                if (err){
                    console.log(err);
                }
                console.log(tweet);
        });
    }

}

module.exports = Scratch3Twitter;