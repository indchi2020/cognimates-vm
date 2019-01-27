const ArgumentType = require('../../extension-support/argument-type');
const BlockType = require('../../extension-support/block-type');
const Clone = require('../../util/clone');
const Cast = require('../../util/cast');
const Timer = require('../../util/timer');
const request = require('request');
const RenderedTarget = require('../../sprites/rendered-target');
// const response = require('response');
const iconURI = require('./assets/watson_icon');
const fs = require('browserify-fs');
let image;

const Runtime = require('../../engine/runtime');
const formatMessage = require('format-message');
const Video = require('../../io/video');
const VideoState = {
    /** Video turned off. */
    OFF: 'off',

    /** Video turned on with default y axis mirroring. */
    ON: 'on',

    /** Video turned on without default y axis mirroring. */
    ON_FLIPPED: 'on-flipped'
};

//variables to make sure requests are complete before continuing
const REQUEST_STATE = {
    IDLE: 0,
    PENDING: 1,
    FINISHED: 2
  };
let classifyRequestState = REQUEST_STATE.IDLE;

//server info
let classifyURL = 'http://cognimate.me:2635/vision/classify';
// let updateURL = 'https://cognimate.me:3477/vision/update';

//classifier_id
let classifier_id;
let api_key;

//for parsing image response
let watson_response; //the full response
let classes; //the classes and scores returned for the watson_response
let image_class; //the highest scoring class returned for an image

//response when updating a classifier
let update_response;

//image that user takes
let videoElement;
let hidden_canvas;
let imageData;
let _track;

class Scratch3Watson {
    constructor (runtime) {
        /**
         * The runtime instantiating this block package.
         * @type {Runtime}
         */
        this.runtime = runtime;

        /**
         * The last millisecond epoch timestamp that the video stream was
         * analyzed.
         * @type {number}
         */
        this._lastUpdate = null;
        this._lastFrame = undefined;


        if (this.runtime.ioDevices) {
            // Clear target motion state values when the project starts.
            // this.runtime.on(Runtime.PROJECT_RUN_START, this.reset.bind(this));

            // Kick off looping the analysis logic.
            this._loop();

            // Configure the video device with values from a globally stored
            // location.
            this.setVideoTransparency({
                TRANSPARENCY: this.globalVideoTransparency
            });
            this.videoToggle({
                VIDEO_STATE: this.globalVideoState
            });

            this.videoToggle({
                VIDEO_STATE: 'on'
            });
        }
    }

    /**
     * After analyzing a frame the amount of milliseconds until another frame
     * is analyzed.
     * @type {number}
     */
    static get INTERVAL () {
        return 33;
    }

    /**
     * Dimensions the video stream is analyzed at after its rendered to the
     * sample canvas.
     * @type {Array.<number>}
     */
    static get DIMENSIONS () {
        return [480, 360];
    }

    /**
     * The transparency setting of the video preview stored in a value
     * accessible by any object connected to the virtual machine.
     * @type {number}
     */
    get globalVideoTransparency () {
        const stage = this.runtime.getTargetForStage();
        if (stage) {
            return stage.videoTransparency;
        }
        return 50;
    }

    set globalVideoTransparency (transparency) {
        const stage = this.runtime.getTargetForStage();
        if (stage) {
            stage.videoTransparency = transparency;
        }
        return transparency;
    }

    /**
     * The video state of the video preview stored in a value accessible by any
     * object connected to the virtual machine.
     * @type {number}
     */
    get globalVideoState () {
        const stage = this.runtime.getTargetForStage();
        if (stage) {
            return stage.videoState;
        }
        return VideoState.ON;
    }

    set globalVideoState (state) {
        const stage = this.runtime.getTargetForStage();
        if (stage) {
            stage.videoState = state;
        }
        return state;
    }

    /**
     * Occasionally step a loop to sample the video, stamp it to the preview
     * skin, and add a TypedArray copy of the canvas's pixel data.
     * @private
     */
    _loop () {
        setTimeout(this._loop.bind(this), Math.max(this.runtime.currentStepTime, Scratch3Watson.INTERVAL));

        // Add frame to detector
        const time = Date.now();
        if (this._lastUpdate === null) {
            this._lastUpdate = time;
        }
        const offset = time - this._lastUpdate;
        if (offset > Scratch3Watson.INTERVAL) {
            const frame = this.runtime.ioDevices.video.getFrame({
                format: Video.FORMAT_IMAGE_DATA,
                dimensions: Scratch3Watson.DIMENSIONS
            });
            if (frame) {
                this._lastUpdate = time;
                this._lastFrame = frame;
                // this.detect.addFrame(frame.data);
            }
        }

    }

    /**
     * Create data for a menu in scratch-blocks format, consisting of an array
     * of objects with text and value properties. The text is a translated
     * string, and the value is one-indexed.
     * @param {object[]} info - An array of info objects each having a name
     *   property.
     * @return {array} - An array of objects with text and value properties.
     * @private
     */
    _buildMenu (info) {
        return info.map((entry, index) => {
            const obj = {};
            obj.text = entry.name;
            obj.value = entry.value || String(index + 1);
            return obj;
        });
    }

    /**
     * States the video sensing activity can be set to.
     * @readonly
     * @enum {string}
     */
    static get VideoState () {
        return VideoState;
    }

    /**
     * An array of info on video state options for the "turn video [STATE]" block.
     * @type {object[]} an array of objects
     * @param {string} name - the translatable name to display in the video state menu
     * @param {string} value - the serializable value stored in the block
     */
    get VIDEO_STATE_INFO () {
        return [
            {
                name: formatMessage({
                    id: 'videoSensing.off',
                    default: 'off',
                    description: 'Option for the "turn video [STATE]" block'
                }),
                value: VideoState.OFF
            },
            {
                name: formatMessage({
                    id: 'videoSensing.on',
                    default: 'on',
                    description: 'Option for the "turn video [STATE]" block'
                }),
                value: VideoState.ON
            },
            {
                name: formatMessage({
                    id: 'videoSensing.onFlipped',
                    default: 'on flipped',
                    description: 'Option for the "turn video [STATE]" block that causes the video to be flipped' +
                        ' horizontally (reversed as in a mirror)'
                }),
                value: VideoState.ON_FLIPPED
            }
        ];
    }
    getInfo () {
        return {
            id: 'watson',
            name: 'Watson',
            blockIconURI: iconURI,
            blocks: [
                {
                    opcode: 'setAPI',
                    blockType: BlockType.COMMAND,
                    text: 'Set API key to [KEY]',
                    arguments:{
                        KEY:{
                            type: ArgumentType.STRING,
                            defaultValue: 'key'
                        }
                    }
                },
                // {
                //     opcode: 'getModelFromList',
                //     blockType: BlockType.COMMAND,
                //     text: 'Choose image model from list: [MODELNAME]',
                //     arguments: {
                //         MODELNAME: {
                //             type: ArgumentType.STRING,
                //             menu: 'models',
                //             defaultValue: 'RockPaperScissors'
                //         }
                //     }
                // },
                {
                    opcode: 'getModelfromString',
                    blockType: BlockType.COMMAND,
                    text: 'Choose image model using id: [IDSTRING]',
                    //[THIS] needs to be equal to THIS in arguments
                    arguments: {
                        IDSTRING: {
                            type: ArgumentType.STRING,
                            defaultValue: 'model id'
                        }
                    }
                },
                {
                    opcode: 'takePhoto',
                    blockType: BlockType.COMMAND,
                    text: 'Take photo from webcam'
                },
                // {
                //     opcode: 'setPhotoFromURL',
                //     blockType: BlockType.COMMAND,
                //     text: 'Use photo from url [URL]',
                //     arguments: {
                //         URL: {
                //             type: ArgumentType.STRING,
                //             defaultValue: 'add link here'
                //         }
                //     }
                // },
                {
                    opcode: 'recognizeObject',
                    blockType: BlockType.REPORTER,
                    text: 'What do you see in the photo?',
                },
                {
                    opcode: 'getScore',
                    blockType: BlockType.REPORTER,
                    text: 'How sure are you the photo is a [CLASS]?',
                    arguments:{
                        CLASS: {
                            type: ArgumentType.STRING,
                            defaultValue: 'add category here'
                        }
                    }
                },
                {
                    opcode: 'clearResults',
                    blockType: BlockType.COMMAND,
                    text: 'Clear results'
                }
                // {
                //     opcode: 'updateClassifier',
                //     blockType: BlockType.COMMAND,
                //     text: 'Add photo to [LABEL]',
                //     arguments:{
                //         LABEL:{
                //             type: ArgumentType.STRING,
                //             defaultValue: 'add category here'
                //         }
                //     }
                // }
            ],
            menus: {
                models: ['Default','RockPaperScissors'],
            }
        };
    }


    // getModelFromList (args, util){
    //     classifier_id = modelDictionary[args.MODELNAME];
    //     console.log(classifier_id);
    // }

    getModelfromString (args, util){
        if(args.IDSTRING !== 'classifier id'){
            classifier_id = args.IDSTRING;
        }
    }

    getScore(args, util){
        //check that classes is not empty
        if(classes === null){
            return 'did you classify an object yet?'
        }
        var comparison_class = args.CLASS;
        //make sure the class entered is valid
        if(!classes.hasOwnProperty(comparison_class)){
            return 'this is not a valid class'
        }
        return classes[comparison_class];
    }

    takePhoto (args, util) {
        imageData = this.runtime.ioDevices.video.getSnapshot();
    }

    recognizeObject(args,util) {
        if(classifyRequestState == REQUEST_STATE.FINISHED) {
          classifyRequestState = REQUEST_STATE.IDLE;
          image_class = this.parseResponse(watson_response);
          return image_class;
        }
        if(classifyRequestState == REQUEST_STATE.PENDING) {
          util.yield()
        }
        if(classifyRequestState == REQUEST_STATE.IDLE) {
            image_class = null
            classes = {};
            let image = imageData
            this.classify(classifier_id,
                image,
                function(err, response) {
                if (err)
                    console.log(err);
                else {
                    watson_response = JSON.parse(response, null, 2);
                }
                classifyRequestState = REQUEST_STATE.FINISHED;
            });
            if(classifyRequestState == REQUEST_STATE.IDLE) {
            classifyRequestState = REQUEST_STATE.PENDING;
            util.yield();
            }
        }
      }

    parseResponse(input){
        for (var i = 0, length = input.length; i < length; i++) {
            classes[input[i].class] = input[i].score;
        }
        //figure out the highest scoring class
        var class_label;
        var best_score = 0;
        for (var key in classes) {
            if (classes.hasOwnProperty(key)) {
                if(classes[key]>best_score){
                    best_score = classes[key];
                    class_label = key;
                }
            }
        }
        return class_label;
    }

    classify(classifier, image, callback) {
        if(!api_key){
            return 'No API key set';
        }
        if(image.substring(0,4) === 'data'){
            request.post({
                url:     classifyURL,
                headers: {'apikey': api_key},
                form: {classifier_id: classifier, image_data: image}
                }, function(error, response, body){
                callback(error, body);
                });
        } else{
            request.post({
                url:     classifyURL,
                headers: {'apikey': api_key},
                form:    { classifier_id: classifier,
                            image_data: image}
                }, function(error, response, body){
                    callback(error, body);
                });
        }
    }


    setAPI(args, util){
        api_key = args.KEY
    }

    // setPhotoFromURL(args,util){
    //     if(args.URL === 'add link here'){
    //         return 'invalid link'
    //     } else{
    //         imageData = args.URL
    //     }
    // }

    clearResults () {
        image_class = null;
        imageData = null;
        classes = {};
    }

    // updateClassifier(args, util){
    //     if(imageData.substring(0,4) === 'data'){
    //         request.post({
    //             url:     updateURL,
    //             form:    { api_key: "1438a8fdb764f1c8af8ada02e6c601cec369fc40",
    //                         version_date: '2018-03-19', classifier_id: classifier_id,
    //                         label: args.LABEL,
    //                         positive_example: imageData }
    //             }, function(err, response, body) {
    //                 if (err)
    //                     console.log(err);
    //                 else {
    //                     update_response = response.body;
    //                     console.log(response);
    //                     console.log(update_response);
    //                 }
    //             });
    //     } else{
    //         return 'Only use webcam photos!'
    //     }
    // }

    videoToggle (args) {
        const state = args.VIDEO_STATE;
        this.globalVideoState = state;
        if (state === VideoState.OFF) {
            if(videoElement){
                trackerTask.stop();
                videoElement.pause();
                _track.stop();
                videoElement = null;
                _track = null;
            }
            this.runtime.ioDevices.video.disableVideo();
        } else {
            // this._setupVideo();
            this.runtime.ioDevices.video.enableVideo();
            // Mirror if state is ON. Do not mirror if state is ON_FLIPPED.
            this.runtime.ioDevices.video.mirror = state === VideoState.ON;
        }
    }

    /**
     * A scratch command block handle that configures the video preview's
     * transparency from passed arguments.
     * @param {object} args - the block arguments
     * @param {number} args.TRANSPARENCY - the transparency to set the video
     *   preview to
     */
    setVideoTransparency (args) {
        const transparency = Cast.toNumber(args.TRANSPARENCY);
        this.globalVideoTransparency = transparency;
        this.runtime.ioDevices.video.setPreviewGhost(transparency);
    }
}

module.exports = Scratch3Watson;
