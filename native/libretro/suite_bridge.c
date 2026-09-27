/* Suite's software-video libretro frontend. One core per owner process.
 * No ROM modifications, cheats, network services, or hardware-render fallbacks.
 * libretro.h is the upstream MIT-licensed API header; see its copyright notice.
 */
#include "libretro.h"
#include <dlfcn.h>
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define FN(name) static __typeof__(retro_##name) *core_##name
FN(set_environment); FN(set_video_refresh); FN(set_audio_sample); FN(set_audio_sample_batch);
FN(set_input_poll); FN(set_input_state); FN(init); FN(deinit); FN(get_system_info);
FN(get_system_av_info); FN(load_game); FN(unload_game); FN(run); FN(serialize_size);
FN(serialize); FN(unserialize); FN(get_memory_data); FN(get_memory_size);
FN(set_controller_port_device);
static void *library, *rom_data;
static unsigned width, height, pixel_format, buttons;
static int16_t touch_x, touch_y;
static bool touching, initialized, loaded, original_gb;
static unsigned char *pixels;
static size_t pixel_capacity, audio_count;
static int16_t audio_buffer[32768];
static struct retro_system_av_info av;
static char system_path[4096], save_path[4096], library_path[4096], error[512];
static struct {char *key; char *value;} options[1024];
static unsigned option_count;

static void logger(enum retro_log_level level,const char *format,...) {
    if(level<RETRO_LOG_WARN)return;
    va_list args;va_start(args,format);vfprintf(stderr,format,args);va_end(args);
}
static void option(const char *key,const char *value) {
    if(!key||!value||option_count>=1024)return;
    for(unsigned i=0;i<option_count;i++)if(!strcmp(options[i].key,key))return;
    /* Software composition keeps a deterministic 256x384 touchscreen surface. */
    if(!strcmp(key,"melonds_render_mode"))value="software";
    if(!strcmp(key,"melonds_screen_layout"))value="top-bottom";
    if(!strcmp(key,"mgba_gb_model")&&original_gb)value="Game Boy";
    if(!strcmp(key,"mgba_sgb_borders"))value="OFF";
    options[option_count].key=strdup(key);options[option_count++].value=strdup(value);
}
static bool environment(unsigned cmd,void *data) {
    switch(cmd) {
    case RETRO_ENVIRONMENT_GET_CAN_DUPE: *(bool*)data=true;return true;
    case RETRO_ENVIRONMENT_GET_SYSTEM_DIRECTORY: *(const char**)data=system_path;return true;
    case RETRO_ENVIRONMENT_GET_SAVE_DIRECTORY: *(const char**)data=save_path;return true;
    case RETRO_ENVIRONMENT_GET_LIBRETRO_PATH: *(const char**)data=library_path;return true;
    case RETRO_ENVIRONMENT_GET_CORE_ASSETS_DIRECTORY: *(const char**)data=system_path;return true;
    case RETRO_ENVIRONMENT_GET_USERNAME: *(const char**)data="Suite";return true;
    case RETRO_ENVIRONMENT_GET_LANGUAGE: *(unsigned*)data=RETRO_LANGUAGE_ENGLISH;return true;
    case RETRO_ENVIRONMENT_GET_LOG_INTERFACE: ((struct retro_log_callback*)data)->log=logger;return true;
    case RETRO_ENVIRONMENT_SET_PIXEL_FORMAT:
        if(*(unsigned*)data>2)return false;pixel_format=*(unsigned*)data;return true;
    case RETRO_ENVIRONMENT_GET_CORE_OPTIONS_VERSION: *(unsigned*)data=2;return true;
    case RETRO_ENVIRONMENT_GET_VARIABLE: {
        struct retro_variable *v=data;v->value=NULL;
        for(unsigned i=0;i<option_count;i++)if(!strcmp(options[i].key,v->key)){v->value=options[i].value;return true;}
        return false;
    }
    case RETRO_ENVIRONMENT_SET_VARIABLES: {
        const struct retro_variable *v=data;
        for(;v&&v->key;v++) {
            const char *start=strstr(v->value,"; ");if(!start)continue;
            char value[256];snprintf(value,sizeof(value),"%s",start+2);char *end=strchr(value,'|');if(end)*end=0;
            option(v->key,value);
        }return true;
    }
    case RETRO_ENVIRONMENT_SET_CORE_OPTIONS_INTL:
        data=((struct retro_core_options_intl*)data)->us;
        /* fall through */
    case RETRO_ENVIRONMENT_SET_CORE_OPTIONS: {
        const struct retro_core_option_definition *d=data;
        for(;d&&d->key;d++)option(d->key,d->default_value?d->default_value:d->values[0].value);
        return true;
    }
    case RETRO_ENVIRONMENT_SET_CORE_OPTIONS_V2_INTL:
        data=((struct retro_core_options_v2_intl*)data)->us;
        /* fall through */
    case RETRO_ENVIRONMENT_SET_CORE_OPTIONS_V2: {
        const struct retro_core_option_v2_definition *d=((struct retro_core_options_v2*)data)->definitions;
        for(;d&&d->key;d++)option(d->key,d->default_value?d->default_value:d->values[0].value);
        return true;
    }
    case RETRO_ENVIRONMENT_GET_VARIABLE_UPDATE: *(bool*)data=false;return true;
    case RETRO_ENVIRONMENT_GET_INPUT_BITMASKS:return true;
    case RETRO_ENVIRONMENT_GET_INPUT_MAX_USERS: *(unsigned*)data=1;return true;
    case RETRO_ENVIRONMENT_GET_AUDIO_VIDEO_ENABLE: *(int*)data=3;return true;
    case RETRO_ENVIRONMENT_GET_FASTFORWARDING: *(bool*)data=false;return true;
    case RETRO_ENVIRONMENT_GET_TARGET_REFRESH_RATE: *(float*)data=59.898308f;return true;
    case RETRO_ENVIRONMENT_SET_GEOMETRY:av.geometry=*(struct retro_game_geometry*)data;return true;
    case RETRO_ENVIRONMENT_SET_SYSTEM_AV_INFO:av=*(struct retro_system_av_info*)data;return true;
    case RETRO_ENVIRONMENT_SET_INPUT_DESCRIPTORS:
    case RETRO_ENVIRONMENT_SET_CONTROLLER_INFO:
    case RETRO_ENVIRONMENT_SET_CORE_OPTIONS_DISPLAY:
    case RETRO_ENVIRONMENT_SET_CORE_OPTIONS_UPDATE_DISPLAY_CALLBACK:
    case RETRO_ENVIRONMENT_SET_SUPPORT_NO_GAME:
    case RETRO_ENVIRONMENT_SET_PERFORMANCE_LEVEL:
    case RETRO_ENVIRONMENT_SET_MEMORY_MAPS:
    case RETRO_ENVIRONMENT_SET_SUBSYSTEM_INFO:return true;
    default:return false;
    }
}
static void video(const void *data,unsigned w,unsigned h,size_t pitch) {
    if(!data||data==RETRO_HW_FRAME_BUFFER_VALID||w>4096||h>4096)return;
    size_t needed=(size_t)w*h*4;
    if(needed>pixel_capacity){void *p=realloc(pixels,needed);if(!p)return;pixels=p;pixel_capacity=needed;}
    width=w;height=h;
    for(unsigned y=0;y<h;y++)for(unsigned x=0;x<w;x++) {
        unsigned r,g,b;const unsigned char *row=(const unsigned char*)data+y*pitch;
        if(pixel_format==RETRO_PIXEL_FORMAT_XRGB8888) {
            uint32_t p;memcpy(&p,row+x*4,4);r=(p>>16)&255;g=(p>>8)&255;b=p&255;
        }else{
            uint16_t p;memcpy(&p,row+x*2,2);
            if(pixel_format==RETRO_PIXEL_FORMAT_RGB565){r=((p>>11)&31)*255/31;g=((p>>5)&63)*255/63;}
            else{r=((p>>10)&31)*255/31;g=((p>>5)&31)*255/31;}
            b=(p&31)*255/31;
        }
        unsigned char *out=pixels+((size_t)y*w+x)*4;out[0]=r;out[1]=g;out[2]=b;out[3]=255;
    }
}
static size_t audio_batch(const int16_t *data,size_t frames) {
    size_t count=frames*2;if(count>32768-audio_count)count=32768-audio_count;
    memcpy(audio_buffer+audio_count,data,count*sizeof(int16_t));audio_count+=count;return frames;
}
static void audio_sample(int16_t left,int16_t right){int16_t data[]={left,right};audio_batch(data,1);}
static void poll(void){}
static int16_t input(unsigned port,unsigned device,unsigned index,unsigned id) {
    if(port||index)return 0;
    if(device==RETRO_DEVICE_JOYPAD)return id==RETRO_DEVICE_ID_JOYPAD_MASK?(int16_t)buttons:(buttons>>id)&1;
    if(device==RETRO_DEVICE_POINTER){
        if(id==RETRO_DEVICE_ID_POINTER_X)return touch_x;
        if(id==RETRO_DEVICE_ID_POINTER_Y)return touch_y;
        if(id==RETRO_DEVICE_ID_POINTER_PRESSED)return touching;
        if(id==RETRO_DEVICE_ID_POINTER_COUNT)return touching?1:0;
    }return 0;
}
const char *suite_error(void){return error;}
int suite_open(const char *core,const char *rom,const char *save,const char *system) {
    if(library){snprintf(error,sizeof(error),"An emulator is already loaded in this owner.");return 0;}
    snprintf(system_path,sizeof(system_path),"%s",system);snprintf(save_path,sizeof(save_path),"%s",save);
    snprintf(library_path,sizeof(library_path),"%s",core);
    original_gb=strlen(rom)>3&&!strcmp(rom+strlen(rom)-3,".gb");
    library=dlopen(core,RTLD_NOW|RTLD_LOCAL);
    if(!library){snprintf(error,sizeof(error),"%s",dlerror());return 0;}
#define LOAD(name) if(!(core_##name=dlsym(library,"retro_"#name))){snprintf(error,sizeof(error),"Missing retro_"#name);return 0;}
    LOAD(set_environment);LOAD(set_video_refresh);LOAD(set_audio_sample);LOAD(set_audio_sample_batch);
    LOAD(set_input_poll);LOAD(set_input_state);LOAD(init);LOAD(deinit);LOAD(get_system_info);
    LOAD(get_system_av_info);LOAD(load_game);LOAD(unload_game);LOAD(run);LOAD(serialize_size);
    LOAD(serialize);LOAD(unserialize);LOAD(get_memory_data);LOAD(get_memory_size);LOAD(set_controller_port_device);
    core_set_environment(environment);core_set_video_refresh(video);core_set_audio_sample(audio_sample);
    core_set_audio_sample_batch(audio_batch);core_set_input_poll(poll);core_set_input_state(input);
    core_init();initialized=true;
    struct retro_system_info info={0};core_get_system_info(&info);
    struct retro_game_info game={.path=rom};
    if(!info.need_fullpath) {
        FILE *file=fopen(rom,"rb");if(!file){snprintf(error,sizeof(error),"Game image unavailable.");return 0;}
        fseek(file,0,SEEK_END);long size=ftell(file);rewind(file);
        if(size<=0||size>536870912){fclose(file);snprintf(error,sizeof(error),"Invalid game size.");return 0;}
        rom_data=malloc(size);if(!rom_data||fread(rom_data,1,size,file)!=(size_t)size){fclose(file);return 0;}
        fclose(file);game.data=rom_data;game.size=size;
    }
    loaded=core_load_game(&game);
    if(!loaded){snprintf(error,sizeof(error),"Core rejected the game. Check its firmware and renderer requirements.");return 0;}
    core_set_controller_port_device(0,RETRO_DEVICE_JOYPAD);
    core_get_system_av_info(&av);return 1;
}
void suite_run(unsigned mask,int16_t x,int16_t y,int pressed){buttons=mask;touch_x=x;touch_y=y;touching=pressed;audio_count=0;core_run();}
unsigned suite_width(void){return width;}unsigned suite_height(void){return height;}
double suite_fps(void){return av.timing.fps;}double suite_sample_rate(void){return av.timing.sample_rate;}
const void *suite_pixels(void){return pixels;}const void *suite_audio(void){return audio_buffer;}
size_t suite_audio_bytes(void){return audio_count*2;}
size_t suite_state_size(void){return core_serialize_size();}
int suite_serialize(void *data,size_t size){return core_serialize(data,size);}
int suite_unserialize(const void *data,size_t size){return core_unserialize(data,size);}
void *suite_sram(void){return core_get_memory_data(RETRO_MEMORY_SAVE_RAM);}
size_t suite_sram_size(void){return core_get_memory_size(RETRO_MEMORY_SAVE_RAM);}
void suite_close(void){
    if(loaded)core_unload_game();if(initialized)core_deinit();
    if(library)dlclose(library);free(rom_data);free(pixels);
    for(unsigned i=0;i<option_count;i++){free(options[i].key);free(options[i].value);}
    library=NULL;rom_data=NULL;pixels=NULL;loaded=false;initialized=false;option_count=0;pixel_capacity=0;
}
