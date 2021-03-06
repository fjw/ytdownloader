var request = require('request');
var cheerio = require('cheerio');
var _ = require('lodash');
var Q = require('q');
var querystring = require('querystring');
var fs = require('fs');
var https = require('https');
var Entities = require('html-entities').AllHtmlEntities;
var exec = require('child_process').exec;
var Jetty = require("jetty");


var entities = new Entities();
var jetty = new Jetty(process.stdout);

// -----------------------------------

var d = function(vari) { console.log(require('util').inspect(vari, {colors: true, depth: 7})); };
var dd = function(vari) { console.log(require('util').inspect(vari, {colors: true, depth: 7})); process.exit(); };

// -----------------------------------


var baseuri = "https://www.youtube.com";

var username = "quill18creates";
var dest = __dirname + "/down";
var parallelvideos = 6;
var retries = 0;
var waittime = 10000;
var ffmpegsettings = ""; //"-vcodec copy -acodec copy";
var debug = false;


console.log("\n");
console.log("crawling youtube. getting all videos....");
//getAllVideosInAllPlaylistsOfUser(username).then(function(list) {

    var list = JSON.parse(fs.readFileSync("test.json"));

    fs.stat(dest, function(err, stats) {

        // DownloadOrdner erstellen
        if(err) {
            fs.mkdirSync(dest);
        }

        var downloadlist = [];

        _.each(list, function(playlist) {

            var playlistfolder = dest + "/" + formatfilename(playlist.title);

            _.each(playlist.videos, function(video) {

                downloadlist.push(
                    {
                        id: video.id,
                        dest: playlistfolder + "/" + formatfilename(video.title) + ".mp4",
                        playlistfolder: playlistfolder,
                        title: video.title
                    }
                );

            });

        });

        startDownloads(downloadlist);

    });

//});


var slots = [];
var msgs = "";

function startDownloads(downloadlist) {

    var slotids = 0;
    setInterval(function() {

        if (downloadlist.length > 0 && slots.length < parallelvideos) {

            downloadNext(downloadlist, slotids, false);
            slotids++;

        }

        jetty.clear();
        jetty.moveTo([0,0]);

        jetty.text(downloadlist.length + " videos remaining... \n\n");


        _.each(slots, function(slot) {

            jetty.rgb([1,1,4]).text(slot.title + "\n").reset();
            if(slot.status == "downloading") {
                jetty.text("    => " + slot.status + " - audio: " + slot.audioprogress + "%  video: " + slot.videoprogress + "% \n");
            } else if (slot.status == "encoding") {
                jetty.text("    => " + slot.status + " - videolength: " + slot.encodingprogress + " \n");
            } else {
                jetty.text("    => " + slot.status + " \n");
            }

            if( slot.retries > 0 ) {
                jetty.rgb([6,3,3]).text("    => retry #" + slot.retries + "\n").reset();
                jetty.text("    => last error:\n" + slot.lasterror + "\n");
            }

            jetty.text("\n");

        });

        jetty.text(msgs);

        if(downloadlist.length == 0 && slots.length == 0) {
            jetty.text(" ------------- all done ------------- ");
            process.exit();
        }

    }, 300);

}


function downloadNext(downloadlist, slotid, failed) {
    var thisdownload;

    if(!failed) {
        thisdownload = downloadlist.shift();

        slots.push({
            id: slotid,
            status: "starting",
            audioprogress: 0,
            videoprogress: 0,
            encodingprogress: "",
            title: thisdownload.title,
            lasterror: "",
            retries: 0,
            waitStart: 0,
            data: thisdownload
        });

    } else {

        //alter job
        var index = _.findIndex(slots, function(item) {
            return item.id == slotid;
        });
        thisdownload = slots[index].data;

        if(slots[index].waitStart + waittime < Date.now()) {
            slots[index].status = "waiting";
            setTimeout(function() {
                downloadNext(downloadlist, slotid, true);
            }, 3000);
            return;
        }
    }

    fs.stat(thisdownload.playlistfolder, function(err, stats) {

        if (err) {
            fs.mkdirSync(thisdownload.playlistfolder);
        }



        getVideoAndAudioAndDownloadAndEncode(thisdownload.id, thisdownload.dest, function(s) {


            //status
            var index = _.findIndex(slots, function(item) {
               return item.id == slotid;
            });

            if(index >= 0) {

                if (s.status) {
                    slots[index].status = s.status;
                }
                if (s.audioprogress) {
                    slots[index].audioprogress = s.audioprogress;
                }
                if (s.videoprogress) {
                    slots[index].videoprogress = s.videoprogress;
                }
                if (s.encodingprogress) {
                    slots[index].encodingprogress = s.encodingprogress;
                }

            }

        }).then(function () {

            //done
            slots = _.reject(slots, function(item) { return item.id == slotid; });

        }, function(err) {

            dd(err);

            //failed
            //status
            var index = _.findIndex(slots, function(item) {
                return item.id == slotid;
            });

            if(index >= 0) {
                slots[index].status = "failed";
                slots[index].audioprogress = 0;
                slots[index].videoprogress = 0;
                slots[index].encodingprogress = "";
                slots[index].retries++;
                slots[index].waitStart = Date.now();
                slots[index].lasterror = err;
            }

            if(slots[index].retries > retries) {
                slots = _.reject(slots, function(item) { return item.id == slotid; });
            } else {
                downloadNext(downloadlist, slotid, true);
            }

        });

    });

}




// ----------------------------------------



function formatfilename(str) {
    return entities.decode(str).replace(/[^a-z0-9\-]/gi, '_').toLowerCase().replace(/_+/g, "_");
}

function getVideoAndAudioAndDownloadAndEncode(id, dest, scb) {
    var deferred = Q.defer();

    fs.stat(dest, function(err, stats) {

        if(err) {
            // Datei existiert noch nicht

            scb( { status: "getting videodata from yt" } );

            getBestVideoUrl(id).then(function (data) {

                scb( { status: "downloading" } );

                Q.all([
                    (function () {
                        var deferred = Q.defer();

                        download(data.video, dest + "_video", scb, "videoprogress").then(function () {
                            deferred.resolve();
                        }, function (error) {
                            deferred.reject(error);
                        });

                        return deferred.promise;
                    })(),
                    (function () {
                        var deferred = Q.defer();

                        download(data.audio, dest + "_audio", scb, "audioprogress").then(function () {
                            deferred.resolve();
                        }, function (error) {
                            deferred.reject(error);
                        });

                        return deferred.promise;
                    })()

                ]).then(function () {

                    //console.log(" -> downloads done. encoding");
                    scb( { status: "encoding" } );

                    //encode
                    var sets = "";
                    if (ffmpegsettings != "") {
                        sets = ffmpegsettings + " ";
                    }
                    var cmd = 'ffmpeg -i ' + dest + "_video -i " + dest + "_audio " + sets + dest + " -v quiet -progress -";

                    var child = exec(cmd, {maxBuffer: 1024 * 1024 * 5}, function (err, stdout, stderr) { //Maxbuffer auf 5 MB

                        if (!err) {
                            deferred.resolve();
                        } else {

                            deferred.reject(err);
                        }

                        fs.unlink(dest+"_video");
                        fs.unlink(dest+"_audio");


                    });

                    child.stdout.on("data", function(data) {
                        var m = data.match(/out_time=([^\s]+)/);;
                        if(m.length >= 2) {
                            var t = m[1].split(".")[0];
                            scb({encodingprogress: t});
                        }
                    });


                }, function(err) {
                    deferred.reject(err);
                });

            }, function(err) {
                deferred.reject(err);
            });
        } else {
            //console.log(" -> finished video there... skipping..")
            deferred.resolve();
        }
    });

    return deferred.promise;
}

function download(url, dest, scb, statuskey) {
    var deferred = Q.defer();

    fs.stat(dest, function(err, stats) {

        if(!err) {
            // file exists
            fs.unlinkSync(dest);
        }

        var file = fs.createWriteStream(dest);

        https.get(url, function (response) {

            var len = parseInt(response.headers['content-length'], 10);
            var cur = 0;


            response.pipe(file);

            file.on('finish', function () {

                file.close(function () {
                    deferred.resolve();
                });
            });

            response.on("data", function (chunk) {
                cur += chunk.length;

                var s = {};
                s[statuskey] = Math.round(100.0 * cur / len);

                scb(s);
            });


        }).on('error', function (err) {
            fs.unlink(dest);

            d("fpp");
            dd(err);

            deferred.reject(err.message);

        });


    });

    return deferred.promise;
}


function getBestVideoUrl(id) {
    var deferred = Q.defer();

    request(baseuri + "/get_video_info?video_id=" + id, function (error, response, body) {

        if (!error && response.statusCode == 200) {

            var infos = querystring.parse(body);

            if(!infos["adaptive_fmts"]) {
                deferred.reject(error);
                return;
            }

            var rformats = infos["adaptive_fmts"].split(",");

            var formats = [];
            _.each(rformats, function(item) {
                formats.push(querystring.parse(item));
            });


            //best Resolution
            var maxqualityvideo = _.maxBy(formats, function(item) {
                if( (/video\/mp4/).test(item.type) ) {
                    return parseInt(item.quality_label);
                } else {
                    return 0;
                }
            });

            var maxqualityaudio = _.maxBy(formats, function(item) {
                if( (/audio\/mp4/).test(item.type) ) {
                    return parseInt(item.bitrate);
                } else {
                    return 0;
                }
            });

            deferred.resolve({ video: maxqualityvideo.url, audio: maxqualityaudio.url });

        } else {
            deferred.reject(error);
        }

    });

    return deferred.promise;
}


// ---------------------------------------- get Links and IDs

function getAllVideosInAllPlaylistsOfUser(username, callback) {
    var deferred = Q.defer();

    getPlaylistsOfUser(username).then(function (playlists) {

        var promises = [];
        _.each(playlists, function (playlist) {

            promises.push(getVideosInPlaylist(playlist.playlistid));

        });

        Q.all(promises).then(function (videos) {

            var fullplaylists = [];

            videos = _.flatten(videos);

            _.each(playlists, function (playlist) {

                var vv = [];

                _.each(_.filter(videos, function (item) {
                    return item.playlistid == playlist.playlistid;
                }), function(v) {

                    vv.push({
                        title: v.title,
                        id: v.videoid
                    })

                });


                fullplaylists.push({
                    title: playlist.title,
                    videos: vv
                });

            });

            deferred.resolve(fullplaylists);

        }, function(error) {
            deferred.reject(error);
        });

    }, function(error) {
        deferred.reject(error);
    });

    return deferred.promise;
}



function getPlaylistsOfUser(username) {
    var deferred = Q.defer();

    request(baseuri + "/c/" + username + "/playlists", function (error, response, body) {

        if (!error && response.statusCode == 200) {

            var $ = cheerio.load(body);

            var listtags = $(".yt-lockup-title a");

            var playlists = [];

            _.each(listtags, function(item, i) {

                if(!debug || i == 0) {

                    var listtag = $(item);

                    var playlistidmatch = listtag.attr("href").match(/playlist\?list=([^&]+)/);

                    if(playlistidmatch != null && playlistidmatch.length >= 2) {

                        var playlist = {
                            title: listtag.html().replace(/^[\s]*/, "").replace(/[\s]*$/g, ""),
                            playlistid: playlistidmatch[1]
                        };

                        playlists.push(playlist);

                    }

                }

            });

            deferred.resolve(playlists);

        } else {
            deferred.reject(error);
        }

    });

    return deferred.promise;
}

function getVideosInPlaylist(id) {
    var deferred = Q.defer();


    request(baseuri + "/playlist?list=" + id, function (error, response, body) {

        if (!error && response.statusCode == 200) {

            var $ = cheerio.load(body);

            var vtags = $(".pl-video-title a");

            var videos = [];

            _.each(vtags, function (item, i) {

                if(!debug || i == 0) {

                    var vtag = $(item);

                    var videoidmatch = vtag.attr("href").match(/watch\?v=([^&]+)/);

                    if(videoidmatch != null && videoidmatch.length >= 2) {

                        var v = {
                            playlistid: id,
                            videoid: videoidmatch[1],
                            title: vtag.html().replace(/^[\s]*/, "").replace(/[\s]*$/g, "")
                        };

                        videos.push(v);

                    }

                }

            });

            deferred.resolve(videos);


        } else {
            deferred.reject(error);
        }

    });

    return deferred.promise;
}


