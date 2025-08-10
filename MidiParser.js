/**
 * MIDI Parser class
 *
 * @author      Aurélien Lorieux
 * @version     1.1.2
 * @url         https://github.com/colxi/js-midi
 *
 */
const MidiParser = (function(root){ 'use strict';

  /**
   * Look-up table for Note number to Note name conversion
   * @type {Array}
   */
  const noteNumberToName = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

  /**
   * Constructor
   * @param {string} data   Binary string from the MIDI file
   */
  let MidiParser = function(data){

    // the data is not a string, but an ArrayBuffer
    // checking the first bytes of the file
    if( !(data instanceof ArrayBuffer) || data.byteLength < 18 || (new TextDecoder('utf-8')).decode( new Uint8Array(data.slice(0, 4)) ) !== 'MThd' ){
      throw new Error('MidiParser: Wrong MIDI file format.');
      return false;
    }

    // parsing the MIDI file
    this._data = new Uint8Array(data);
    this._dataOffset = 0;
    this._event = [];
    this._totalTracks = 0;
    this._track = [];
    this.tempo = [];
    this.format = 0;
    this.ppqn = 0;
    this.ticksPerBeat = 0;
    this._lastEventType = 0;

    // Start parsing
    this._parseHeader();
    this._parseTracks();

    // sorting events by ticks
    // this._event.sort(function(a,b){
    //   return a.tick - b.tick;
    // });
    return this;
  };

  /**
   * Converts a note number to a note name
   * @param  {Number} n Note number
   * @return {String}   Note name
   */
  MidiParser.prototype.noteNumberToName = function(n){
    // an octave has 12 notes
    // the index is the note number in the octave
    // the octave is the note number divided by 12
    return noteNumberToName[ n % 12 ] + ( Math.floor(n/12) - 1 );
  };

  /**
   * Returns all the events from the MIDI file
   * @return {Array} Events
   */
  MidiParser.prototype.getEvents = function(){
    return this._event;
  };

  /**
   * Returns all the tempo events from the MIDI file
   * @return {Array} Tempo events
   */
  MidiParser.prototype.getTempoEvents = function(){
    return this.tempo;
  };

  /**
   * Reads a string from the data
   * @param  {Number} len String length
   * @return {String}     The string
   */
  MidiParser.prototype._readString = function(len){
    let str = (new TextDecoder('utf-8')).decode( this._data.slice(this._dataOffset, this._dataOffset+len) );
    this._dataOffset += len;
    return str;
  };

  /**
   * Reads a number from the data
   * @param  {Number} len Number length in bytes
   * @return {Number}     The number
   */
  MidiParser.prototype._readNumber = function(len){
    let n = 0;
    for(let i=0; i<len; i++){
      n = n << 8;
      n += this._data[this._dataOffset+i];
    }
    this._dataOffset += len;
    return n;
  };

  /**
   * Reads a variable length number from the data
   * @return {Number} The number
   */
  MidiParser.prototype._readVariableLengthNumber = function(){
    let n = 0;
    let v = 0;
    do{
      v = this._data[this._dataOffset++];
      n = n << 7;
      n += v & 0x7F;
    }while(v & 0x80);
    return n;
  };

  /**
   * Parses the header of the MIDI file
   */
  MidiParser.prototype._parseHeader = function(){
    if(this._readString(4) !== 'MThd')
      return this._throwError('Wrong MIDI file format.');

    if(this._readNumber(4) !== 6)
      return this._throwError('Wrong header length.');

    this.format = this._readNumber(2);
    this._totalTracks = this._readNumber(2);

    let ppqn = this._readNumber(2);
    if(ppqn & 0x8000){
      this.ticksPerBeat = 0; // TODO: Implement SMPTE timecode
    }else{
      this.ticksPerBeat = ppqn;
    }
  };

  /**
   * Parses the tracks of the MIDI file
   */
  MidiParser.prototype._parseTracks = function(){

    for(let i=0; i<this._totalTracks; i++){
      this._track = [];
      if(this._readString(4) !== 'MTrk')
        return this._throwError('Wrong track header.');

      let trackLength = this._readNumber(4);
      let trackEnd = this._dataOffset + trackLength;

      let tick = 0;
      while(this._dataOffset < trackEnd){

        //
        // http://www.somascape.org/midi/tech/mfile.html
        //
        tick += this._readVariableLengthNumber();

        let eventType = this._readNumber(1);

        // check for running status
        if(eventType < 0x80){
          eventType = this._lastEventType;
          this._dataOffset--;
        }

        switch(eventType & 0xF0){
          case 0x80: // note off
            this._parseNoteOff(tick, eventType & 0x0F);
            break;

          case 0x90: // note on
            this._parseNoteOn(tick, eventType & 0x0F);
            break;

          case 0xA0: // note aftertouch
            this._parseNoteAftertouch(tick, eventType & 0x0F);
            break;

          case 0xB0: // controller
            this._parseController(tick, eventType & 0x0F);
            break;

          case 0xC0: // program change
            this._parseProgramChange(tick, eventType & 0x0F);
            break;

          case 0xD0: // channel aftertouch
            this._parseChannelAftertouch(tick, eventType & 0x0F);
            break;

          case 0xE0: // pitch bend
            this._parsePitchBend(tick, eventType & 0x0F);
            break;

          case 0xF0: // meta event
            this._parseMetaEvent(tick, eventType);
            break;

          default:
            return this._throwError('Unknown event type: ' + eventType.toString(16));
        }

        this._lastEventType = eventType;
      }
    }
  };


  MidiParser.prototype._pushEvent = function(tick, type, data){

    // if note off, check for the note on event to set the duration
    if(type === 8){ // 8 = note off
      for(let i=this._event.length-1; i>=0; i--){
        if( this._event[i].type === 9 && // 9 = note on
            this._event[i].channel === data.channel &&
            this._event[i].note === data.note &&
            this._event[i].duration === undefined
          ){
            this._event[i].duration = tick - this._event[i].tick;
            return;
        }
      }
    }

    this._event.push({
      tick: tick,
      type: type,
      ...data
    });
  };

  /**
   * Parses a note off event
   * @param  {Number} tick    Current tick
   * @param  {Number} channel Channel
   */
  MidiParser.prototype._parseNoteOff = function(tick, channel){
    let note = this._readNumber(1);
    let velocity = this._readNumber(1);

    this._pushEvent(tick, 8, {
      channel: channel,
      note: note,
      velocity: velocity
    });
  };

  /**
   * Parses a note on event
   * @param  {Number} tick    Current tick
   * @param  {Number} channel Channel
   */
  MidiParser.prototype._parseNoteOn = function(tick, channel){
    let note = this._readNumber(1);
    let velocity = this._readNumber(1);

    if(velocity === 0){ // note on with velocity 0 is a note off
      this._parseNoteOff(tick, channel, note, velocity);
      return;
    }

    this._pushEvent(tick, 9, {
      channel: channel,
      note: note,
      velocity: velocity
    });
  };

  /**
   * Parses a note aftertouch event
   * @param  {Number} tick    Current tick
   * @param  {Number} channel Channel
   */
  MidiParser.prototype._parseNoteAftertouch = function(tick, channel){
    let note = this._readNumber(1);
    let value = this._readNumber(1);

    this._pushEvent(tick, 10, {
      channel: channel,
      note: note,
      value: value
    });
  };

  /**
   * Parses a controller event
   * @param  {Number} tick    Current tick
   * @param  {Number} channel Channel
   */
  MidiParser.prototype._parseController = function(tick, channel){
    let controller = this._readNumber(1);
    let value = this._readNumber(1);

    this._pushEvent(tick, 11, {
      channel: channel,
      controller: controller,
      value: value
    });
  };

  /**
   * Parses a program change event
   * @param  {Number} tick    Current tick
   * @param  {Number} channel Channel
   */
  MidiParser.prototype._parseProgramChange = function(tick, channel){
    let program = this._readNumber(1);

    this._pushEvent(tick, 12, {
      channel: channel,
      program: program
    });
  };

  /**
   * Parses a channel aftertouch event
   * @param  {Number} tick    Current tick
   * @param  {Number} channel Channel
   */
  MidiParser.prototype._parseChannelAftertouch = function(tick, channel){
    let value = this._readNumber(1);

    this._pushEvent(tick, 13, {
      channel: channel,
      value: value
    });
  };

  /**
   * Parses a pitch bend event
   * @param  {Number} tick    Current tick
   * @param  {Number} channel Channel
   */
  MidiParser.prototype._parsePitchBend = function(tick, channel){
    let value = this._readNumber(2);

    this._pushEvent(tick, 14, {
      channel: channel,
      value: value
    });
  };

  /**
   * Parses a meta event
   * @param  {Number} tick    Current tick
   * @param  {Number} eventType Event type
   */
  MidiParser.prototype._parseMetaEvent = function(tick, eventType){
    let metaEventType = this._readNumber(1);
    let metaEventLength = this._readVariableLengthNumber();

    switch(metaEventType){
      case 0x00: // sequence number
        this._parseSequenceNumber(tick, metaEventType, metaEventLength);
        break;

      case 0x01: // text event
        this._parseTextEvent(tick, metaEventType, metaEventLength);
        break;

      case 0x02: // copyright notice
        this._parseCopyrightNotice(tick, metaEventType, metaEventLength);
        break;

      case 0x03: // track name
        this._parseTrackName(tick, metaEventType, metaEventLength);
        break;

      case 0x04: // instrument name
        this._parseInstrumentName(tick, metaEventType, metaEventLength);
        break;

      case 0x05: // lyric
        this._parseLyric(tick, metaEventType, metaEventLength);
        break;

      case 0x06: // marker
        this._parseMarker(tick, metaEventType, metaEventLength);
        break;

      case 0x07: // cue point
        this._parseCuePoint(tick, metaEventType, metaEventLength);
        break;

      case 0x20: // channel prefix
        this._parseChannelPrefix(tick, metaEventType, metaEventLength);
        break;

      case 0x2F: // end of track
        this._parseEndOfTrack(tick, metaEventType, metaEventLength);
        break;

      case 0x51: // set tempo
        this._parseSetTempo(tick, metaEventType, metaEventLength);
        break;

      case 0x54: // smpte offset
        this._parseSmpteOffset(tick, metaEventType, metaEventLength);
        break;

      case 0x58: // time signature
        this._parseTimeSignature(tick, metaEventType, metaEventLength);
        break;

      case 0x59: // key signature
        this._parseKeySignature(tick, metaEventType, metaEventLength);
        break;

      case 0x7F: // sequencer specific meta event
        this._parseSequencerSpecificMetaEvent(tick, metaEventType, metaEventLength);
        break;

      default:
        // skipping unknown meta event
        this._dataOffset += metaEventLength;
        break;
    }
  };

  /**
   * Parses a sequence number event
   * @param  {Number} tick    Current tick
   * @param  {Number} eventType Event type
   * @param  {Number} eventLength Event length
   */
  MidiParser.prototype._parseSequenceNumber = function(tick, eventType, eventLength){
    let sequenceNumber = this._readNumber(eventLength);
    //
  };

  /**
   * Parses a text event
   * @param  {Number} tick    Current tick
   * @param  {Number} eventType Event type
   * @param  {Number} eventLength Event length
   */
  MidiParser.prototype._parseTextEvent = function(tick, eventType, eventLength){
    let text = this._readString(eventLength);
    //
  };

  /**
   * Parses a copyright notice event
   * @param  {Number} tick    Current tick
   * @param  {Number} eventType Event type
   * @param  {Number} eventLength Event length
   */
  MidiParser.prototype._parseCopyrightNotice = function(tick, eventType, eventLength){
    let copyright = this._readString(eventLength);
    //
  };

  /**
   * Parses a track name event
   * @param  {Number} tick    Current tick
   * @param  {Number} eventType Event type
   * @param  {Number} eventLength Event length
   */
  MidiParser.prototype._parseTrackName = function(tick, eventType, eventLength){
    let trackName = this._readString(eventLength);
    //
  };

  /**
   * Parses an instrument name event
   * @param  {Number} tick    Current tick
   * @param  {Number} eventType Event type
   * @param  {Number} eventLength Event length
   */
  MidiParser.prototype._parseInstrumentName = function(tick, eventType, eventLength){
    let instrumentName = this._readString(eventLength);
    //
  };

  /**
   * Parses a lyric event
   * @param  {Number} tick    Current tick
   * @param  {Number} eventType Event type
   * @param  {Number} eventLength Event length
   */
  MidiParser.prototype._parseLyric = function(tick, eventType, eventLength){
    let lyric = this._readString(eventLength);
    //
  };

  /**
   * Parses a marker event
   * @param  {Number} tick    Current tick
   * @param  {Number} eventType Event type
   * @param  {Number} eventLength Event length
   */
  MidiParser.prototype._parseMarker = function(tick, eventType, eventLength){
    let marker = this._readString(eventLength);
    //
  };

  /**
   * Parses a cue point event
   * @param  {Number} tick    Current tick
   * @param  {Number} eventType Event type
   * @param  {Number} eventLength Event length
   */
  MidiParser.prototype._parseCuePoint = function(tick, eventType, eventLength){
    let cuePoint = this._readString(eventLength);
    //
  };

  /**
   * Parses a channel prefix event
   * @param  {Number} tick    Current tick
   * @param  {Number} eventType Event type
   * @param  {Number} eventLength Event length
   */
  MidiParser.prototype._parseChannelPrefix = function(tick, eventType, eventLength){
    let channel = this._readNumber(eventLength);
    //
  };

  /**
   * Parses an end of track event
   * @param  {Number} tick    Current tick
   * @param  {Number} eventType Event type
   * @param  {Number} eventLength Event length
   */
  MidiParser.prototype._parseEndOfTrack = function(tick, eventType, eventLength){
    //
  };

  /**
   * Parses a set tempo event
   * @param  {Number} tick    Current tick
   * @param  {Number} eventType Event type
   * @param  {Number} eventLength Event length
   */
  MidiParser.prototype._parseSetTempo = function(tick, eventType, eventLength){
    let tempo = this._readNumber(eventLength);
    this.tempo.push({
      tick: tick,
      bpm: 60000000 / tempo
    });
  };

  /**
   * Parses a SMPTE offset event
   * @param  {Number} tick    Current tick
   * @param  {Number} eventType Event type
   * @param  {Number} eventLength Event length
   */
  MidiParser.prototype._parseSmpteOffset = function(tick, eventType, eventLength){
    let hour = this._readNumber(1);
    let minute = this._readNumber(1);
    let second = this._readNumber(1);
    let frame = this._readNumber(1);
    let subFrame = this._readNumber(1);
    //
  };

  /**
   * Parses a time signature event
   * @param  {Number} tick    Current tick
   * @param  {Number} eventType Event type
   * @param  {Number} eventLength Event length
   */
  MidiParser.prototype._parseTimeSignature = function(tick, eventType, eventLength){
    let numerator = this._readNumber(1);
    let denominator = this._readNumber(1);
    let metronome = this._readNumber(1);
    let thirtySecondNotes = this._readNumber(1);
    //
  };

  /**
   * Parses a key signature event
   * @param  {Number} tick    Current tick
   * @param  {Number} eventType Event type
   * @param  {Number} eventLength Event length
   */
  MidiParser.prototype._parseKeySignature = function(tick, eventType, eventLength){
    let key = this._readNumber(1);
    let scale = this._readNumber(1);
    //
  };

  /**
   * Parses a sequencer specific meta event
   * @param  {Number} tick    Current tick
   * @param  {Number} eventType Event type
   * @param  {Number} eventLength Event length
   */
  MidiParser.prototype._parseSequencerSpecificMetaEvent = function(tick, eventType, eventLength){
    let data = this._readString(eventLength);
    //
  };

  /**
   * Throws an error
   * @param  {String} msg Error message
   */
  MidiParser.prototype._throwError = function(msg){
    throw new Error('MidiParser: ' + msg);
  };

  return MidiParser;
}(this));